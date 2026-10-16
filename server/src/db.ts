import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export interface StoredMessage {
  id: string;
  chat_id: string;
  chat_name: string | null;
  is_group: boolean;
  sender_id: string | null;
  sender_name: string | null;
  from_me: boolean;
  /** unix seconds */
  timestamp: number;
  text: string | null;
  message_type: string;
  quoted_message_id: string | null;
  mentions_me: boolean;
  replies_to_me: boolean;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  id                TEXT PRIMARY KEY,
  chat_id           TEXT NOT NULL,
  chat_name         TEXT,
  is_group          INTEGER NOT NULL,
  sender_id         TEXT,
  sender_name       TEXT,
  from_me           INTEGER NOT NULL,
  timestamp         INTEGER NOT NULL,
  text              TEXT,
  message_type      TEXT NOT NULL,
  quoted_message_id TEXT,
  mentions_me       INTEGER NOT NULL DEFAULT 0,
  replies_to_me     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages (chat_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages (timestamp);

CREATE TABLE IF NOT EXISTS chats (
  id       TEXT PRIMARY KEY,
  name     TEXT,
  is_group INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS summaries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  INTEGER NOT NULL,
  range_since INTEGER NOT NULL,
  range_until INTEGER NOT NULL,
  chat_ids    TEXT,
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  status      TEXT NOT NULL,
  result_json TEXT,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_summaries_created ON summaries (created_at);
`;

export type Db = ReturnType<typeof openDb>;

export function openDb(file: string) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  const insertMessage = db.prepare(`
    INSERT INTO messages (id, chat_id, chat_name, is_group, sender_id, sender_name, from_me, timestamp,
                          text, message_type, quoted_message_id, mentions_me, replies_to_me)
    VALUES (@id, @chat_id, @chat_name, @is_group, @sender_id, @sender_name, @from_me, @timestamp,
            @text, @message_type, @quoted_message_id, @mentions_me, @replies_to_me)
    ON CONFLICT (id) DO NOTHING`);
  const upsertChatStmt = db.prepare(`
    INSERT INTO chats (id, name, is_group) VALUES (@id, @name, @is_group)
    ON CONFLICT (id) DO UPDATE SET name = COALESCE(excluded.name, chats.name)`);
  const fillChatNameStmt = db.prepare(`
    INSERT INTO chats (id, name, is_group) VALUES (@id, @name, @is_group)
    ON CONFLICT (id) DO UPDATE SET name = COALESCE(chats.name, excluded.name)`);
  const chatNameStmt = db.prepare('SELECT name FROM chats WHERE id = ?');
  const isFromMeStmt = db.prepare('SELECT from_me FROM messages WHERE id = ?');
  const statsStmt = db.prepare('SELECT COUNT(*) AS count, MAX(timestamp) AS last FROM messages');
  const messagesInRangeStmt = db.prepare(`
    SELECT m.*,
           COALESCE(c.name, m.chat_name, m.chat_id) AS display_chat,
           COALESCE(m.sender_name, s.name, m.sender_id, '?') AS display_sender
    FROM messages m
    LEFT JOIN chats c ON c.id = m.chat_id
    LEFT JOIN chats s ON s.id = m.sender_id
    WHERE m.timestamp > @since AND m.timestamp <= @until
      AND (@chat_ids IS NULL OR m.chat_id IN (SELECT value FROM json_each(@chat_ids)))
    ORDER BY m.chat_id, m.timestamp, m.id`);
  const lastSummaryStmt = db.prepare(`
    SELECT range_until FROM summaries WHERE status = 'ok' AND chat_ids IS NULL ORDER BY id DESC LIMIT 1`);
  const insertSummaryStmt = db.prepare(`
    INSERT INTO summaries (created_at, range_since, range_until, chat_ids, provider, model, status, result_json, error)
    VALUES (@created_at, @range_since, @range_until, @chat_ids, @provider, @model, @status, @result_json, @error)`);
  const summaryColumns = `id, created_at, range_since, range_until, chat_ids, provider, model, status, error,
    json_array_length(result_json, '$.must_not_miss') AS must_not_miss_count,
    json_array_length(result_json, '$.per_chat') AS chat_count`;
  const listSummariesStmt = db.prepare(`SELECT ${summaryColumns} FROM summaries ORDER BY id DESC`);
  const getSummaryStmt = db.prepare(`SELECT ${summaryColumns}, result_json FROM summaries WHERE id = ?`);
  const chatsOverviewStmt = db.prepare(`
    SELECT m.chat_id AS id,
           COALESCE(c.name, MAX(m.chat_name), m.chat_id) AS name,
           m.is_group AS is_group,
           SUM(CASE WHEN m.from_me = 0 AND m.timestamp > @since THEN 1 ELSE 0 END) AS unread_since_last_summary,
           MAX(m.timestamp) AS last_message_at
    FROM messages m
    LEFT JOIN chats c ON c.id = m.chat_id
    GROUP BY m.chat_id
    ORDER BY unread_since_last_summary DESC, last_message_at DESC`);

  const toRow = (m: StoredMessage) => ({
    ...m,
    is_group: m.is_group ? 1 : 0,
    from_me: m.from_me ? 1 : 0,
    mentions_me: m.mentions_me ? 1 : 0,
    replies_to_me: m.replies_to_me ? 1 : 0,
  });

  return {
    raw: db,

    /** Inserts messages, ignoring ids that already exist. Returns number of new rows. */
    upsertMessages(messages: StoredMessage[]): number {
      let inserted = 0;
      db.transaction(() => {
        for (const m of messages) inserted += insertMessage.run(toRow(m)).changes;
      })();
      return inserted;
    },

    /** Sets an authoritative chat name (group subject, saved contact name). */
    upsertChat(id: string, name: string | null, isGroup: boolean) {
      upsertChatStmt.run({ id, name, is_group: isGroup ? 1 : 0 });
    },

    /** Records a fallback chat name (e.g. push name) only if none is known yet. */
    fillChatName(id: string, name: string | null, isGroup: boolean) {
      fillChatNameStmt.run({ id, name, is_group: isGroup ? 1 : 0 });
    },

    chatName(id: string): string | null {
      return (chatNameStmt.get(id) as { name: string | null } | undefined)?.name ?? null;
    },

    isFromMe(messageId: string): boolean {
      return (isFromMeStmt.get(messageId) as { from_me: number } | undefined)?.from_me === 1;
    },

    stats(): { messageCount: number; lastMessageTimestamp: number | null } {
      const r = statsStmt.get() as { count: number; last: number | null };
      return { messageCount: r.count, lastMessageTimestamp: r.last };
    },

    /** Messages with since < timestamp <= until, ordered by chat then time, with current display names. */
    messagesInRange(since: number, until: number, chatIds: string[] | null): RangeMessage[] {
      return messagesInRangeStmt
        .all({ since, until, chat_ids: chatIds ? JSON.stringify(chatIds) : null })
        .map((r) => {
          const row = r as Record<string, unknown>;
          return {
            ...(row as unknown as StoredMessage),
            is_group: row.is_group === 1,
            from_me: row.from_me === 1,
            mentions_me: row.mentions_me === 1,
            replies_to_me: row.replies_to_me === 1,
            display_chat: row.display_chat as string,
            display_sender: row.display_sender as string,
          };
        });
    },

    /** End of the last successful summary over all chats, in unix seconds. */
    lastSummaryUntil(): number | null {
      return (lastSummaryStmt.get() as { range_until: number } | undefined)?.range_until ?? null;
    },

    insertSummary(row: SummaryRow): number {
      return Number(insertSummaryStmt.run({ ...row, chat_ids: row.chat_ids ? JSON.stringify(row.chat_ids) : null }).lastInsertRowid);
    },

    listSummaries(): SummaryListRow[] {
      return listSummariesStmt.all() as SummaryListRow[];
    },

    getSummary(id: number): (SummaryListRow & { result_json: string | null }) | undefined {
      return getSummaryStmt.get(id) as (SummaryListRow & { result_json: string | null }) | undefined;
    },

    /** Every chat with stored messages, with the number of messages from others after `since`. */
    chatsOverview(since: number): ChatOverviewRow[] {
      return chatsOverviewStmt.all({ since }).map((r) => {
        const row = r as Omit<ChatOverviewRow, 'is_group'> & { is_group: number };
        return { ...row, is_group: row.is_group === 1 };
      });
    },

    close() {
      db.close();
    },
  };
}

export interface RangeMessage extends StoredMessage {
  display_chat: string;
  display_sender: string;
}

export interface SummaryRow {
  created_at: number;
  range_since: number;
  range_until: number;
  chat_ids: string[] | null;
  provider: string;
  model: string;
  status: 'ok' | 'error';
  result_json: string | null;
  error: string | null;
}

export interface SummaryListRow {
  id: number;
  created_at: number;
  range_since: number;
  range_until: number;
  chat_ids: string | null;
  provider: string;
  model: string;
  status: 'ok' | 'error';
  error: string | null;
  must_not_miss_count: number | null;
  chat_count: number | null;
}

export interface ChatOverviewRow {
  id: string;
  name: string;
  is_group: boolean;
  unread_since_last_summary: number;
  last_message_at: number;
}
