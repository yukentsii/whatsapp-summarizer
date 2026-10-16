import type { z } from 'zod';
import type { RangeMessage } from '../db.js';
import type { SummaryProvider } from './provider.js';
import {
  ChatChunkSummarySchema,
  MergedBriefSchema,
  OverallSchema,
  toProviderSchema,
  type ChatChunkSummary,
  type Summary,
  type SummaryItem,
} from './schema.js';

export interface PipelineOptions {
  language: string;
  /** Approximate token budget for the messages in one model call. */
  chunkTokens?: number;
  /** How many chats are summarized in parallel. */
  concurrency?: number;
  /** IANA time zone used when rendering message times for the model. */
  timeZone?: string;
  /** The owner's first name; in groups, a message that says it counts as addressed to the owner. */
  ownerName?: string;
}

export class InvalidModelOutputError extends Error {}

const DEFAULT_CHUNK_TOKENS = 20_000;

/** Rough token estimate; Turkish text runs at roughly 3 characters per token. */
export const estimateTokens = (s: string) => Math.ceil(s.length / 3);

function formatTime(unix: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(unix * 1000));
}

const MEDIA_LABELS: Record<string, string> = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'voice message',
  documentMessage: 'document',
  stickerMessage: 'sticker',
  contactMessage: 'contact',
  locationMessage: 'location',
  liveLocationMessage: 'live location',
};

/** True if the text contains the owner's name, including Turkish suffixes ("Deniz'e", "Denizcim"). */
export function namesOwner(text: string | null, ownerName?: string): boolean {
  if (!text || !ownerName?.trim()) return false;
  return text.toLocaleLowerCase('tr-TR').includes(ownerName.trim().toLocaleLowerCase('tr-TR'));
}

/**
 * A message is for the owner only if it is in a one-to-one chat, or in a group it tags the owner,
 * replies to one of the owner's messages, or says the owner's name.
 */
export function addressedToOwner(m: RangeMessage, ownerName?: string): boolean {
  if (m.from_me) return false;
  return !m.is_group || m.mentions_me || m.replies_to_me || namesOwner(m.text, ownerName);
}

/** One line per message: `[id] time sender (flags): text`. */
export function formatMessage(m: RangeMessage, timeZone?: string, ownerName?: string): string {
  const sender = m.from_me ? 'ME' : m.display_sender;
  const flags: string[] = [];
  if (m.mentions_me) flags.push('mentions ME');
  if (!m.from_me && namesOwner(m.text, ownerName)) flags.push('names ME');
  if (m.replies_to_me) flags.push('replies to ME');
  else if (m.quoted_message_id) flags.push(`replies to ${m.quoted_message_id}`);
  const media = MEDIA_LABELS[m.message_type];
  const body = [media ? `<${media}>` : null, m.text].filter(Boolean).join(' ') || `<${m.message_type}>`;
  const flagText = flags.length ? ` (${flags.join(', ')})` : '';
  return `[${m.id}] ${formatTime(m.timestamp, timeZone)} ${sender}${flagText}: ${body.replace(/\s*\n\s*/g, ' / ')}`;
}

/** Splits formatted lines into chunks that stay under the token budget (a single huge line gets its own chunk). */
export function chunkLines(lines: string[], maxTokens: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let tokens = 0;
  for (const line of lines) {
    const t = estimateTokens(line) + 1;
    if (current.length && tokens + t > maxTokens) {
      chunks.push(current);
      current = [];
      tokens = 0;
    }
    current.push(line);
    tokens += t;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** Calls the provider, validates with zod, and retries once with the validation error on invalid output. */
export async function callStructured<T>(
  provider: SummaryProvider,
  schema: z.ZodType<T>,
  schemaName: string,
  system: string,
  user: string,
): Promise<T> {
  const jsonSchema = toProviderSchema(schema);
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0
        ? user
        : `${user}\n\nYour previous reply was rejected: ${lastError}\nReply again with only valid JSON matching the schema.`;
    const raw = await provider.complete({ system, user: prompt, schemaName, jsonSchema });
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      lastError = `not valid JSON (${(err as Error).message})`;
      continue;
    }
    const result = schema.safeParse(parsed);
    if (result.success) return result.data;
    lastError = `does not match the schema (${result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ')})`;
  }
  throw new InvalidModelOutputError(`${schemaName}: invalid model output after retry: ${lastError}`);
}

function chatSystemPrompt(language: string, isGroup: boolean): string {
  const addressed = isGroup
    ? `This is a group chat. Most messages are for the whole group, NOT for ME. A message is addressed to ME only if its flags say "mentions ME" (ME was tagged), "replies to ME" or "names ME" (it contains ME's name). Treat every other message as said to the group, even if it is a question or a request.`
    : `This is a one-to-one chat, so the other person's messages are addressed to ME.`;
  return `You summarize WhatsApp messages for the account owner, who appears as "ME".
Each input line is: [message_id] time sender (flags): text. Media is shown as <type> plus its caption.
${addressed}

Return JSON with:
- brief: 1-3 sentences on what happened in this chat. Describe what people said; do not say they talked to or about ME unless those messages are addressed to ME.
- must_not_miss: only messages addressed to ME that ME should not miss: direct questions, deadlines, money or payments, urgent requests, anything waiting on ME's reply.
- questions_to_me: only questions addressed to ME that ME has not answered later in the input.
- mentions_of_me: only messages flagged "mentions ME" or "names ME".
- dates_and_plans: concrete dates, times, meetings, events and plans from anyone in the chat; "when" as written plus the absolute date if it can be inferred from the message time.

Rules:
- Every item must cite the message_id of a real input line, copied exactly. Never invent ids or items; use empty arrays when nothing qualifies.
- When unsure whether a message is meant for ME, it is not: leave it out of must_not_miss, questions_to_me and mentions_of_me.
- In "reason", say plainly who said what (e.g. "Ali asked when the meeting starts"). Only say it was asked of or said to the owner when the message is addressed to ME.
- Ignore messages sent by ME when looking for things ME must act on, except as context.
- Write brief, reason, what and when in ${language}, addressing the owner in the second person ("you"). Never write "ME" in the output.`;
}

export interface ChatResult {
  chat_id: string;
  chat: string;
  brief: string;
  message_count: number;
  items: ChatChunkSummary;
}

async function summarizeChat(
  provider: SummaryProvider,
  messages: RangeMessage[],
  opts: PipelineOptions,
): Promise<ChatResult> {
  const chat = messages[0].display_chat;
  const kind = messages[0].is_group ? 'group' : 'one-to-one chat';
  const lines = messages.map((m) => formatMessage(m, opts.timeZone, opts.ownerName));
  const chunks = chunkLines(lines, opts.chunkTokens ?? DEFAULT_CHUNK_TOKENS);
  const system = chatSystemPrompt(opts.language, messages[0].is_group);

  const parts: ChatChunkSummary[] = [];
  for (const [i, chunk] of chunks.entries()) {
    const part = chunks.length > 1 ? ` (part ${i + 1} of ${chunks.length})` : '';
    const user = `Chat: "${chat}" (${kind})${part}\n\n${chunk.join('\n')}`;
    parts.push(await callStructured(provider, ChatChunkSummarySchema, 'chat_summary', system, user));
  }

  let brief = parts[0].brief;
  if (parts.length > 1) {
    const merged = await callStructured(
      provider,
      MergedBriefSchema,
      'merged_brief',
      `You merge partial summaries of one WhatsApp chat, in chronological order, into a single brief of 1-4 sentences. Write in ${opts.language}. Do not add facts that are not in the parts.`,
      parts.map((p, i) => `Part ${i + 1}: ${p.brief}`).join('\n'),
    );
    brief = merged.brief;
  }

  // Keep only items that cite a message from this chat, once per id.
  const byId = new Map(messages.map((m) => [m.id, m]));
  const grounded = <T extends { message_id: string }>(items: T[], keep: (m: RangeMessage) => boolean = () => true) => {
    const seen = new Set<string>();
    return items.filter((it) => {
      const m = byId.get(it.message_id);
      if (!m || seen.has(it.message_id) || !keep(m)) return false;
      seen.add(it.message_id);
      return true;
    });
  };
  // The model's judgement is not trusted for "is this for me": these sections only keep
  // messages that are verifiably addressed to the owner (or tag/name the owner).
  const forOwner = (m: RangeMessage) => addressedToOwner(m, opts.ownerName);
  const tagsOrNames = (m: RangeMessage) => !m.from_me && (m.mentions_me || namesOwner(m.text, opts.ownerName));
  return {
    chat_id: messages[0].chat_id,
    chat,
    brief,
    message_count: messages.length,
    items: {
      brief,
      must_not_miss: grounded(parts.flatMap((p) => p.must_not_miss), forOwner),
      questions_to_me: grounded(parts.flatMap((p) => p.questions_to_me), forOwner),
      mentions_of_me: grounded(parts.flatMap((p) => p.mentions_of_me), tagsOrNames),
      dates_and_plans: grounded(parts.flatMap((p) => p.dates_and_plans)),
    },
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function groupByChat(messages: RangeMessage[]): RangeMessage[][] {
  const groups = new Map<string, RangeMessage[]>();
  for (const m of messages) {
    const list = groups.get(m.chat_id);
    if (list) list.push(m);
    else groups.set(m.chat_id, [m]);
  }
  return [...groups.values()];
}

const NO_MESSAGES: Record<string, string> = {
  turkish: 'Bu aralıkta yeni mesaj yok.',
};

/** Groups messages by chat, summarizes each chat, then writes one combined summary on top. */
export async function summarize(
  provider: SummaryProvider,
  messages: RangeMessage[],
  range: { since: string; until: string },
  opts: PipelineOptions,
): Promise<Summary> {
  const chats = groupByChat(messages);
  if (chats.length === 0) {
    return {
      range,
      must_not_miss: [],
      questions_to_me: [],
      mentions_of_me: [],
      dates_and_plans: [],
      per_chat: [],
      overall: NO_MESSAGES[opts.language.toLowerCase()] ?? 'No new messages in this range.',
    };
  }

  const results = await mapLimit(chats, opts.concurrency ?? 3, (msgs) => summarizeChat(provider, msgs, opts));

  const byId = new Map(messages.map((m) => [m.id, m]));
  const toItem = (chat: string, it: { message_id: string; reason: string }): SummaryItem => {
    const m = byId.get(it.message_id)!;
    return { chat, sender: m.from_me ? 'ME' : m.display_sender, message_id: it.message_id, reason: it.reason };
  };
  const newestFirst = (a: SummaryItem, b: SummaryItem) =>
    byId.get(b.message_id)!.timestamp - byId.get(a.message_id)!.timestamp;
  const collect = (key: 'must_not_miss' | 'questions_to_me' | 'mentions_of_me') =>
    results.flatMap((r) => r.items[key].map((it) => toItem(r.chat, it))).sort(newestFirst);

  const mustNotMiss = collect('must_not_miss');
  // Busiest chats first in the per-chat section.
  const perChat = [...results].sort((a, b) => b.message_count - a.message_count);

  const overallInput = [
    `Time range: ${range.since} to ${range.until}`,
    '',
    'Per-chat briefs:',
    ...perChat.map((r) => `- ${r.chat} (${r.message_count} messages): ${r.brief}`),
    '',
    'Must not miss:',
    ...(mustNotMiss.length ? mustNotMiss.map((i) => `- ${i.chat} / ${i.sender}: ${i.reason}`) : ['- (none)']),
  ].join('\n');
  const { overall } = await callStructured(
    provider,
    OverallSchema,
    'overall_summary',
    `You write the top-level overview of the account owner's WhatsApp messages from per-chat briefs. Lead with what needs the owner's attention (only the items under "Must not miss" are for the owner; everything else was said to groups), then the most important news, in 3-6 sentences. Write in ${opts.language}, addressing the owner in the second person ("you"); never write "ME". Only use facts from the input.`,
    overallInput,
  );

  return {
    range,
    must_not_miss: mustNotMiss,
    questions_to_me: collect('questions_to_me'),
    mentions_of_me: collect('mentions_of_me'),
    dates_and_plans: results.flatMap((r) =>
      r.items.dates_and_plans.map((d) => ({ what: d.what, when: d.when, chat: r.chat })),
    ),
    per_chat: perChat.map((r) => ({ chat: r.chat, brief: r.brief, message_count: r.message_count })),
    overall,
  };
}
