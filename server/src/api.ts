import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { z } from 'zod';
import type { Db, SummaryListRow } from './db.js';
import { ProviderConfigError } from './summary/factory.js';
import { iso, SummaryInProgressError, type SummaryService } from './summary/service.js';
import { PairingUnavailableError, type PairingState } from './whatsapp.js';

export interface ApiDeps {
  db: Db;
  apiToken: string;
  pairing: () => PairingState;
  requestPairingCode: (phone: string) => Promise<string>;
  summaries: SummaryService;
}

const PairingCodeBody = z.object({ phone: z.string().regex(/^\+?[\d\s()-]{8,20}$/, 'phone must be a number in international format') });

const isoDate = z.iso.datetime({ offset: true }).transform((s) => Math.floor(Date.parse(s) / 1000));
const SummaryBody = z
  .object({
    since: isoDate.optional(),
    until: isoDate.optional(),
    chat_ids: z.array(z.string().min(1)).optional(),
  })
  .refine((b) => b.since === undefined || b.until === undefined || b.since < b.until, {
    message: 'since must be before until',
  });

function summaryMeta(r: SummaryListRow) {
  return {
    id: r.id,
    created_at: iso(r.created_at),
    range: { since: iso(r.range_since), until: iso(r.range_until) },
    status: r.status,
    provider: r.provider,
    model: r.model,
    chat_ids: r.chat_ids ? (JSON.parse(r.chat_ids) as string[]) : null,
    must_not_miss_count: r.must_not_miss_count,
    chat_count: r.chat_count,
    error: r.error,
  };
}

function tokenMatches(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice('Bearer '.length));
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

const isoOrNull = (unixSeconds: number | null) =>
  unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null;

export function buildApi(deps: ApiDeps, opts: FastifyServerOptions = {}) {
  const app = Fastify({
    ...opts,
    logger: opts.logger ?? false,
  });

  app.addHook('onRequest', async (req, reply) => {
    if (!tokenMatches(req.headers.authorization, deps.apiToken)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/pairing', async () => {
    const p = deps.pairing();
    return { status: p.status, qr: p.qr, pairing_code: p.pairingCode };
  });

  app.post('/pairing/code', async (req, reply) => {
    const body = PairingCodeBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0].message });
    try {
      return { pairing_code: await deps.requestPairingCode(body.data.phone) };
    } catch (err) {
      if (err instanceof PairingUnavailableError) return reply.code(409).send({ error: err.message });
      req.log.error({ err: { message: (err as Error).message } }, 'pairing code request failed');
      return reply.code(502).send({ error: `pairing code request failed: ${(err as Error).message}` });
    }
  });

  app.get('/status', async () => {
    const p = deps.pairing();
    const s = deps.db.stats();
    return {
      connection: p.status,
      me: p.me,
      message_count: s.messageCount,
      last_message_time: isoOrNull(s.lastMessageTimestamp),
    };
  });

  app.post('/summaries', async (req, reply) => {
    const body = SummaryBody.safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid body', details: body.error.issues.map((i) => i.message) });
    }
    try {
      return await deps.summaries.run(body.data);
    } catch (err) {
      if (err instanceof SummaryInProgressError) return reply.code(409).send({ error: err.message });
      if (err instanceof ProviderConfigError) return reply.code(503).send({ error: err.message });
      req.log.error({ err: { name: (err as Error).name, message: (err as Error).message } }, 'summary failed');
      return reply.code(502).send({ error: `summary failed: ${(err as Error).message}` });
    }
  });

  app.get('/summaries', async () => deps.db.listSummaries().map(summaryMeta));

  app.get<{ Params: { id: string } }>('/summaries/:id', async (req, reply) => {
    const row = deps.db.getSummary(Number(req.params.id));
    if (!row) return reply.code(404).send({ error: 'not found' });
    const meta = summaryMeta(row);
    if (row.status !== 'ok' || !row.result_json) return meta;
    return { ...meta, ...JSON.parse(row.result_json) };
  });

  app.get('/chats', async () => {
    const since = deps.summaries.defaultSince();
    return deps.db.chatsOverview(since).map((c) => ({
      id: c.id,
      name: c.name,
      is_group: c.is_group,
      unread_since_last_summary: c.unread_since_last_summary,
      last_message_time: iso(c.last_message_at),
    }));
  });

  return app;
}
