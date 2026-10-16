import {
  getContentType,
  isJidGroup,
  jidNormalizedUser,
  normalizeMessageContent,
  type proto,
  type WAMessage,
} from '@whiskeysockets/baileys';
import type { StoredMessage } from './db.js';

export interface ParseContext {
  /** My own JIDs (phone-number and LID form), normalized without device suffix. */
  myIds: Set<string>;
  chatName(chatId: string): string | null;
  isFromMe(messageId: string): boolean;
}

/** Content types that are protocol noise rather than something a person wrote. */
const SKIPPED_TYPES = new Set<string>([
  'protocolMessage',
  'reactionMessage',
  'senderKeyDistributionMessage',
  'messageContextInfo',
  'pollUpdateMessage',
  'keepInChatMessage',
  'encReactionMessage',
  'encEventResponseMessage',
  'pinInChatMessage',
  'stickerSyncRmrMessage',
]);

const STATUS_JID = 'status@broadcast';

/** Prefer the phone-number form of a JID when Baileys gives us a LID plus an alternate. */
export function preferPn(jid: string | null | undefined, alt: string | null | undefined): string | null {
  if (!jid) return alt ? jidNormalizedUser(alt) : null;
  if (jid.endsWith('@lid') && alt?.endsWith('@s.whatsapp.net')) return jidNormalizedUser(alt);
  return jidNormalizedUser(jid);
}

export function toUnixSeconds(ts: WAMessage['messageTimestamp']): number {
  if (ts == null) return 0;
  if (typeof ts === 'number') return ts;
  return Number(ts.toString());
}

function extractText(type: string, content: proto.IMessage): string | null {
  switch (type) {
    case 'conversation':
      return content.conversation ?? null;
    case 'extendedTextMessage':
      return content.extendedTextMessage?.text ?? null;
    case 'imageMessage':
      return content.imageMessage?.caption ?? null;
    case 'videoMessage':
      return content.videoMessage?.caption ?? null;
    case 'documentMessage':
      return content.documentMessage?.caption ?? content.documentMessage?.fileName ?? null;
    case 'contactMessage':
      return content.contactMessage?.displayName ?? null;
    case 'locationMessage':
      return content.locationMessage?.name ?? content.locationMessage?.address ?? null;
    case 'pollCreationMessage':
    case 'pollCreationMessageV2':
    case 'pollCreationMessageV3': {
      const poll = content[type];
      if (!poll?.name) return null;
      const options = (poll.options ?? []).map((o) => o.optionName).filter(Boolean);
      return options.length ? `${poll.name} [${options.join(' / ')}]` : poll.name;
    }
    case 'buttonsResponseMessage':
      return content.buttonsResponseMessage?.selectedDisplayText ?? null;
    case 'listResponseMessage':
      return content.listResponseMessage?.title ?? null;
    case 'templateButtonReplyMessage':
      return content.templateButtonReplyMessage?.selectedDisplayText ?? null;
    case 'eventMessage':
      return content.eventMessage?.name ?? null;
    default:
      return null;
  }
}

function contextInfoOf(type: string, content: proto.IMessage): proto.IContextInfo | null {
  const inner = (content as Record<string, unknown>)[type];
  if (inner && typeof inner === 'object' && 'contextInfo' in inner) {
    return (inner as { contextInfo?: proto.IContextInfo | null }).contextInfo ?? null;
  }
  return null;
}

/**
 * Converts a Baileys message into a storable row. Returns null for messages that
 * should not be stored (status broadcasts, protocol/reaction messages, stubs).
 */
export function parseMessage(msg: WAMessage, ctx: ParseContext): StoredMessage | null {
  const key = msg.key;
  if (!key?.id || !key.remoteJid) return null;
  if (key.remoteJid === STATUS_JID || key.remoteJidAlt === STATUS_JID) return null;

  const content = normalizeMessageContent(msg.message);
  if (!content) return null;
  const type = getContentType(content);
  if (!type || SKIPPED_TYPES.has(type)) return null;

  const isGroup = Boolean(isJidGroup(key.remoteJid));
  const chatId = isGroup ? key.remoteJid : preferPn(key.remoteJid, key.remoteJidAlt)!;
  const fromMe = Boolean(key.fromMe);

  let senderId: string | null;
  if (fromMe) senderId = [...ctx.myIds].find((id) => id.endsWith('@s.whatsapp.net')) ?? null;
  // Live messages carry the group sender in key.participant; history-sync messages in msg.participant.
  else if (isGroup) senderId = preferPn(key.participant || msg.participant, key.participantAlt);
  else senderId = chatId;

  const ci = contextInfoOf(type, content);
  const mentioned = (ci?.mentionedJid ?? []).map((j) => jidNormalizedUser(j));
  const quotedId = ci?.stanzaId || null;
  const quotedParticipant = ci?.participant ? jidNormalizedUser(ci.participant) : null;

  const mentionsMe = !fromMe && mentioned.some((j) => ctx.myIds.has(j));
  const repliesToMe =
    !fromMe &&
    quotedId !== null &&
    ((quotedParticipant !== null && ctx.myIds.has(quotedParticipant)) || ctx.isFromMe(quotedId));

  const pushName = msg.pushName || null;
  const chatName = ctx.chatName(chatId) ?? (!isGroup && !fromMe ? pushName : null);

  return {
    id: key.id,
    chat_id: chatId,
    chat_name: chatName,
    is_group: isGroup,
    sender_id: senderId,
    sender_name: fromMe ? null : pushName ?? (senderId ? ctx.chatName(senderId) : null),
    from_me: fromMe,
    timestamp: toUnixSeconds(msg.messageTimestamp),
    text: extractText(type, content),
    message_type: type,
    quoted_message_id: quotedId,
    mentions_me: mentionsMe,
    replies_to_me: repliesToMe,
  };
}
