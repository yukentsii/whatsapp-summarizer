import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  useMultiFileAuthState,
  type Chat,
  type Contact,
  type WAMessage,
  type WASocket,
} from '@whiskeysockets/baileys';
import type { FastifyBaseLogger } from 'fastify';
import QRCode from 'qrcode';
import type { Db, StoredMessage } from './db.js';
import { parseMessage, preferPn } from './parse.js';

export type ConnectionStatus = 'connecting' | 'awaiting_pairing' | 'open' | 'closed' | 'logged_out';

export interface PairingState {
  status: ConnectionStatus;
  /** QR code as a PNG data URL while waiting for pairing. */
  qr: string | null;
  /** 8-character code to enter on the phone, when PAIRING_PHONE is set. */
  pairingCode: string | null;
  me: string | null;
}

/**
 * Methods that would make this device visible to contacts or change state on my phone.
 * They are replaced with throwing stubs so nothing in this codebase can call them by accident.
 */
const FORBIDDEN_METHODS = [
  'sendMessage',
  'relayMessage',
  'readMessages',
  'sendReceipt',
  'sendReceipts',
  'sendPresenceUpdate',
  'presenceSubscribe',
  'chatModify',
  'star',
  'sendMessageAck',
] as const;

export function lockDownSocket(sock: WASocket): void {
  for (const name of FORBIDDEN_METHODS) {
    if (name in sock) {
      Object.defineProperty(sock, name, {
        value: () => {
          throw new Error(`read-only mode: ${name} is disabled`);
        },
      });
    }
  }
}

export class PairingUnavailableError extends Error {}

export class WhatsAppIngestor {
  readonly state: PairingState = { status: 'connecting', qr: null, pairingCode: null, me: null };
  private myIds = new Set<string>();
  private reconnectDelayMs = 2000;
  private stopped = false;
  private sock: WASocket | null = null;

  constructor(
    private readonly db: Db,
    private readonly authDir: string,
    private readonly logger: FastifyBaseLogger,
    /** Passed to Baileys itself; keep at warn or above, it logs message payloads at debug. */
    private readonly baileysLogger: FastifyBaseLogger,
    private readonly pairingPhone?: string,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  /**
   * Requests an 8-character code for WhatsApp > Linked devices > Link with phone number instead.
   * Only possible while waiting for pairing.
   */
  async requestPairingCode(phone: string): Promise<string> {
    if (this.state.status !== 'awaiting_pairing' || !this.sock) {
      throw new PairingUnavailableError(`cannot request a pairing code while ${this.state.status}`);
    }
    const code = await this.sock.requestPairingCode(phone.replace(/\D/g, ''));
    this.state.pairingCode = code;
    return code;
  }

  stop(): void {
    this.stopped = true;
    this.sock?.end(undefined);
  }

  private async connect(): Promise<void> {
    const { state: auth, saveCreds } = await useMultiFileAuthState(this.authDir);
    // The version bundled with Baileys goes stale and WhatsApp then closes the socket with 428.
    const { version } = await fetchLatestBaileysVersion().catch((err) => {
      this.logger.warn({ err }, 'could not fetch latest WhatsApp Web version, using bundled one');
      return { version: undefined };
    });

    const sock = makeWASocket({
      auth,
      version,
      logger: this.baileysLogger,
      // WhatsApp currently rejects the 'Desktop' device name (428); Chrome is accepted.
      browser: Browsers.macOS('Chrome'),
      // Read-only: never appear online, so receipts go out as "inactive" and my phone keeps notifying.
      markOnlineOnConnect: false,
      syncFullHistory: true,
      shouldSyncHistoryMessage: () => true,
      // Never resend anything on retry requests.
      getMessage: async () => undefined,
    });
    lockDownSocket(sock);
    this.sock = sock;
    let pairingCodeRequested = false;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.state.status = 'awaiting_pairing';
        this.state.qr = await QRCode.toDataURL(qr);
        if (this.pairingPhone && !pairingCodeRequested && !auth.creds.registered) {
          pairingCodeRequested = true;
          try {
            this.state.pairingCode = await sock.requestPairingCode(this.pairingPhone);
            process.stdout.write(`\nPairing code: ${this.state.pairingCode}\n`);
          } catch (err) {
            this.logger.error({ err }, 'failed to request pairing code');
          }
        }
        process.stdout.write('\nScan this QR with WhatsApp > Linked devices:\n');
        process.stdout.write(await QRCode.toString(qr, { type: 'terminal', small: true }));
      }

      if (connection === 'open') {
        this.reconnectDelayMs = 2000;
        this.state.status = 'open';
        this.state.qr = null;
        this.state.pairingCode = null;
        this.setMe(sock);
        this.logger.info({ me: this.state.me }, 'whatsapp connected');
        // A server-side query only; it does not touch my phone or any chat.
        sock
          .groupFetchAllParticipating()
          .then((groups) => {
            for (const g of Object.values(groups)) this.db.upsertChat(g.id, g.subject ?? null, true);
          })
          .catch((err) => this.logger.warn({ err }, 'failed to fetch group subjects'));
      }

      if (connection === 'close') {
        this.sock = null;
        const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
          ?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          this.state.status = 'logged_out';
          this.logger.error(
            `logged out from WhatsApp; delete ${this.authDir} and restart to pair again`,
          );
          return;
        }
        this.state.status = 'closed';
        if (this.stopped) return;
        const delay = code === DisconnectReason.restartRequired ? 0 : this.reconnectDelayMs;
        this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 60_000);
        this.logger.warn({ code, delay }, 'whatsapp connection closed, reconnecting');
        setTimeout(() => {
          this.state.status = 'connecting';
          this.connect().catch((err) => this.logger.error({ err }, 'reconnect failed'));
        }, delay);
      }
    });

    sock.ev.on('messaging-history.set', ({ chats, contacts, messages }) => {
      this.storeChats(chats);
      this.storeContacts(contacts);
      const n = this.storeMessages(messages);
      this.logger.info({ received: messages.length, inserted: n }, 'history sync batch');
    });

    sock.ev.on('messages.upsert', ({ messages }) => {
      const n = this.storeMessages(messages);
      this.logger.debug({ received: messages.length, inserted: n }, 'messages upsert');
    });

    sock.ev.on('chats.upsert', (chats) => this.storeChats(chats));
    sock.ev.on('chats.update', (chats) => this.storeChats(chats as Chat[]));
    sock.ev.on('contacts.upsert', (contacts) => this.storeContacts(contacts));
    sock.ev.on('contacts.update', (contacts) => this.storeContacts(contacts as Contact[]));
    sock.ev.on('groups.upsert', (groups) => {
      for (const g of groups) this.db.upsertChat(g.id, g.subject ?? null, true);
    });
    sock.ev.on('groups.update', (groups) => {
      for (const g of groups) if (g.id && g.subject) this.db.upsertChat(g.id, g.subject, true);
    });
  }

  private setMe(sock: WASocket) {
    const user = sock.user;
    this.myIds.clear();
    if (user?.id) this.myIds.add(jidNormalizedUser(user.id));
    if (user?.lid) this.myIds.add(jidNormalizedUser(user.lid));
    this.state.me = user?.id ? jidNormalizedUser(user.id) : null;
  }

  private storeMessages(messages: WAMessage[]): number {
    const ctx = {
      myIds: this.myIds,
      chatName: (id: string) => this.db.chatName(id),
      isFromMe: (id: string) => this.db.isFromMe(id),
    };
    const rows: StoredMessage[] = [];
    for (const m of messages) {
      try {
        const row = parseMessage(m, ctx);
        if (!row) continue;
        rows.push(row);
        if (!row.is_group && !row.from_me && row.sender_name) {
          this.db.fillChatName(row.chat_id, row.sender_name, false);
        }
      } catch (err) {
        this.logger.warn({ err, id: m.key?.id }, 'failed to parse message');
      }
    }
    return this.db.upsertMessages(rows);
  }

  private storeChats(chats: Partial<Chat>[]) {
    for (const c of chats) {
      if (!c.id || !c.name) continue;
      const isGroup = c.id.endsWith('@g.us');
      const id = isGroup ? c.id : preferPn(c.id, c.pnJid)!;
      this.db.upsertChat(id, c.name, isGroup);
    }
  }

  private storeContacts(contacts: Partial<Contact>[]) {
    for (const c of contacts) {
      if (!c.id) continue;
      const name = c.name || c.notify || c.verifiedName;
      if (!name) continue;
      const id = preferPn(c.id, c.phoneNumber)!;
      // A saved contact name is authoritative; a self-chosen notify name is only a fallback.
      if (c.name) this.db.upsertChat(id, c.name, false);
      else this.db.fillChatName(id, name, false);
      if (c.lid && c.lid !== id) this.db.fillChatName(jidNormalizedUser(c.lid), name, false);
    }
  }
}
