import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { buildApi } from '../src/api.js';
import { openDb } from '../src/db.js';
import { AnthropicProvider } from '../src/summary/anthropic.js';
import { createProvider, ProviderConfigError } from '../src/summary/factory.js';
import { OpenAIProvider } from '../src/summary/openai.js';
import {
  addressedToOwner,
  chunkLines,
  formatMessage,
  InvalidModelOutputError,
  namesOwner,
  summarize,
} from '../src/summary/pipeline.js';
import { ProviderRefusalError, type SummaryProvider } from '../src/summary/provider.js';
import { RateLimitedProvider } from '../src/summary/rate-limit.js';
import { SummarySchema, type Summary } from '../src/summary/schema.js';
import { FIRST_SUMMARY_LOOKBACK_SECONDS, SummaryService } from '../src/summary/service.js';
import { AYSE, CHAT_NAMES, FAMILY, FIXTURE, FIXTURE_CHATS, FIXTURE_END, T0, WORK } from './fixtures/messages.js';
import { INVENTED_ID, MockProvider } from './fixtures/mock-provider.js';

const TOKEN = 'test-token-0123456789';
const RANGE = { since: new Date(T0 * 1000).toISOString(), until: new Date(FIXTURE_END * 1000).toISOString() };

function seededDb() {
  const db = openDb(':memory:');
  for (const [id, name, isGroup] of FIXTURE_CHATS) db.upsertChat(id, name, isGroup);
  db.upsertMessages(FIXTURE);
  return db;
}

const fixtureById = new Map(FIXTURE.map((m) => [m.id, m]));

/** Every flagged item must point at a real fixture message in the chat it is attributed to. */
function assertGrounded(summary: Summary) {
  for (const key of ['must_not_miss', 'questions_to_me', 'mentions_of_me'] as const) {
    for (const item of summary[key]) {
      const m = fixtureById.get(item.message_id);
      assert.ok(m, `${key}: ${item.message_id} is not a stored message`);
      assert.equal(item.chat, CHAT_NAMES[m.chat_id], `${key}: ${item.message_id} attributed to wrong chat`);
      assert.equal(item.sender, m.from_me ? 'ME' : m.sender_name);
    }
  }
}

describe('summary pipeline (fixture: 50 messages, 3 chats)', () => {
  it('has the expected fixture shape', () => {
    assert.equal(FIXTURE.length, 50);
    assert.equal(new Set(FIXTURE.map((m) => m.chat_id)).size, 3);
    assert.equal(new Set(FIXTURE.map((m) => m.id)).size, 50);
  });

  it('summarizes each chat, then combines, with every must_not_miss item referencing a stored message id', async () => {
    const db = seededDb();
    const provider = new MockProvider();
    const summary = await summarize(provider, db.messagesInRange(0, FIXTURE_END, null), RANGE, { language: 'Turkish', ownerName: 'Deniz' });

    assert.ok(SummarySchema.safeParse(summary).success);
    assert.equal(provider.callsFor('chat_summary').length, 3);
    assert.equal(provider.callsFor('overall_summary').length, 1);
    assert.equal(provider.callsFor('merged_brief').length, 0);

    // Group messages about rent, budget and an urgent bug are said to the group, not to the owner,
    // so only the one-to-one items survive even though the model flagged all of them.
    assert.deepEqual(new Set(summary.must_not_miss.map((i) => i.message_id)), new Set(['AYS07', 'AYS10']));
    assert.ok(!summary.must_not_miss.some((i) => i.message_id === INVENTED_ID), 'invented id must be dropped');
    for (const item of summary.must_not_miss) assert.ok(fixtureById.has(item.message_id), item.message_id);
    assertGrounded(summary);

    // Tagged (FAM06, WRK15) or named (FAM13 "Deniz, …", WRK05 "Deniz, …"); the model's extra guesses are dropped.
    assert.deepEqual(new Set(summary.mentions_of_me.map((i) => i.message_id)), new Set(['FAM06', 'WRK15', 'FAM13', 'WRK05']));
    const questionIds = new Set(summary.questions_to_me.map((i) => i.message_id));
    for (const id of ['WRK05', 'FAM06', 'FAM13', 'AYS03']) assert.ok(questionIds.has(id), id);
    for (const id of ['FAM03', 'FAM15', 'WRK13', 'WRK09']) assert.ok(!questionIds.has(id), `${id} was asked to the group`);

    assert.deepEqual(
      summary.per_chat.map((c) => [c.chat, c.message_count]),
      [['Aile', 18], ['Proje Ekibi', 18], ['Ayşe', 14]],
    );
    assert.ok(summary.dates_and_plans.length > 0);
    assert.ok(summary.dates_and_plans.every((d) => Object.values(CHAT_NAMES).includes(d.chat)));
    assert.equal(summary.overall, 'Genel özet: dikkat edilmesi gerekenler var.');

    // must_not_miss is ordered newest first.
    const ts = summary.must_not_miss.map((i) => fixtureById.get(i.message_id)!.timestamp);
    assert.deepEqual(ts, [...ts].sort((a, b) => b - a));
  });

  it('asks for the configured language and marks my messages and flags in the prompt', async () => {
    const db = seededDb();
    const provider = new MockProvider();
    await summarize(provider, db.messagesInRange(0, FIXTURE_END, [WORK, AYSE]), RANGE, { language: 'German', ownerName: 'Deniz' });
    const [call, oneToOne] = [WORK, AYSE].map((chat) =>
      provider.callsFor('chat_summary').find((c) => c.user.includes(`"${CHAT_NAMES[chat]}"`))!);
    assert.match(call.system, /Write brief, reason, what and when in German, addressing the owner in the second person/);
    assert.match(call.system, /This is a group chat\. Most messages are for the whole group, NOT for ME/);
    assert.match(oneToOne.system, /This is a one-to-one chat/);
    assert.match(call.user, /\[WRK05\] \S+ \S+ Mehmet \(names ME, replies to ME\):/);
    assert.match(call.user, /\[WRK03\] \S+ \S+ ME: Raporu cuma/);
    assert.match(call.user, /\[WRK15\] \S+ \S+ Mehmet \(mentions ME, names ME\):/);
    assert.match(call.user, /\[WRK04\] \S+ \S+ Emre: <document> Rapor/);
    assert.ok(call.jsonSchema.properties, 'a JSON schema is passed to the provider');
  });

  it('splits large chats into token-bounded chunks and merges them', async () => {
    const db = seededDb();
    const provider = new MockProvider();
    const summary = await summarize(provider, db.messagesInRange(0, FIXTURE_END, null), RANGE, {
      language: 'Turkish',
      ownerName: 'Deniz',
      chunkTokens: 150,
    });
    const chunkCalls = provider.callsFor('chat_summary');
    assert.ok(chunkCalls.length > 3, `expected more than one chunk per chat, got ${chunkCalls.length} calls`);
    for (const c of chunkCalls) {
      const lines = c.user.split('\n').filter((l) => l.startsWith('['));
      assert.ok(lines.join('\n').length / 3 <= 150 + lines.length + 60, 'chunk exceeds token budget');
    }
    assert.equal(provider.callsFor('merged_brief').length, 3);
    assert.ok(summary.per_chat.every((c) => c.brief === 'Birleştirilmiş özet'));
    assert.equal(summary.per_chat.reduce((n, c) => n + c.message_count, 0), 50);
    assertGrounded(summary);
    // Items from different chunks are kept, and each id only once.
    const ids = summary.must_not_miss.map((i) => i.message_id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(new Set(ids), new Set(['AYS07', 'AYS10']));
  });

  it('retries once on invalid JSON and on schema mismatch', async () => {
    const db = seededDb();
    for (const bad of ['not-json', 'wrong-shape'] as const) {
      const provider = new MockProvider({ badResponses: [bad] });
      const summary = await summarize(provider, db.messagesInRange(0, FIXTURE_END, [AYSE]), RANGE, { language: 'Turkish' });
      assert.equal(provider.callsFor('chat_summary').length, 2, bad);
      assert.match(provider.calls[1].user, /previous reply was rejected/);
      assert.equal(summary.per_chat.length, 1);
    }
  });

  it('gives up after the retry fails', async () => {
    const db = seededDb();
    const provider = new MockProvider({ badResponses: ['not-json', 'wrong-shape'] });
    await assert.rejects(
      summarize(provider, db.messagesInRange(0, FIXTURE_END, [AYSE]), RANGE, { language: 'Turkish' }),
      InvalidModelOutputError,
    );
    assert.equal(provider.calls.length, 2);
  });

  it('returns an empty summary without calling the model when there are no messages', async () => {
    const provider = new MockProvider();
    const summary = await summarize(provider, [], RANGE, { language: 'Turkish' });
    assert.equal(provider.calls.length, 0);
    assert.equal(summary.overall, 'Bu aralıkta yeni mesaj yok.');
    assert.deepEqual(summary.per_chat, []);
  });
});

describe('pipeline helpers', () => {
  it('chunks lines under the budget and keeps oversized lines alone', () => {
    const chunks = chunkLines(['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(300), 'd'], 25);
    assert.deepEqual(chunks.map((c) => c.length), [2, 1, 1]);
  });

  it('formats media without captions', () => {
    const m = { ...FIXTURE.find((x) => x.id === 'FAM17')!, display_chat: 'Aile', display_sender: 'Baba' };
    assert.match(formatMessage(m, 'UTC'), /^\[FAM17\] 2026-10-15 \d\d:\d\d Baba: <voice message>$/);
  });
});

describe('addressed to the owner', () => {
  const base = { ...FIXTURE.find((x) => x.id === 'FAM03')!, display_chat: 'Aile', display_sender: 'Can' };
  it('matches the name with Turkish casing and suffixes', () => {
    for (const t of ["Deniz'e sor", 'DENİZ bakar mısın', 'denizcim nasılsın']) assert.ok(namesOwner(t, 'Deniz'), t);
    assert.ok(!namesOwner('Derya geldi mi', 'Deniz'));
    assert.ok(!namesOwner('Deniz geldi', undefined));
  });
  it('treats group messages as for the owner only when tagged, replied to or named', () => {
    assert.ok(!addressedToOwner(base, 'Deniz'));
    assert.ok(addressedToOwner({ ...base, mentions_me: true }, 'Deniz'));
    assert.ok(addressedToOwner({ ...base, replies_to_me: true }, 'Deniz'));
    assert.ok(addressedToOwner({ ...base, text: 'Deniz ne dersin?' }, 'Deniz'));
    assert.ok(addressedToOwner({ ...base, is_group: false }, 'Deniz'));
    assert.ok(!addressedToOwner({ ...base, is_group: false, from_me: true }, 'Deniz'));
  });
});

describe('SummaryService', () => {
  it('defaults to the last 24h first, then to the end of the last successful summary', async () => {
    const db = seededDb();
    let now = FIXTURE_END + 3600;
    const service = new SummaryService(db, () => new MockProvider(), { language: 'Turkish' }, () => now);

    const first = await service.run({});
    assert.equal(first.range.since, new Date((now - FIRST_SUMMARY_LOOKBACK_SECONDS) * 1000).toISOString());
    assert.equal(first.per_chat.reduce((n, c) => n + c.message_count, 0), 50);

    const firstUntil = now;
    now += 600;
    // A chat-filtered summary does not move the default range.
    await service.run({ chat_ids: [AYSE] });
    const second = await service.run({});
    assert.equal(second.range.since, new Date(firstUntil * 1000).toISOString());
    assert.deepEqual(second.per_chat, []);
  });

  it('stores failed attempts as errors without moving the default range', async () => {
    const db = seededDb();
    const now = FIXTURE_END + 60;
    const service = new SummaryService(
      db,
      () => new MockProvider({ badResponses: ['not-json', 'not-json', 'not-json', 'not-json', 'not-json', 'not-json'] }),
      { language: 'Turkish' },
      () => now,
    );
    await assert.rejects(service.run({}), InvalidModelOutputError);
    const rows = db.listSummaries();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'error');
    assert.equal(db.lastSummaryUntil(), null);
  });
});

describe('summary endpoints', () => {
  function setup() {
    const db = seededDb();
    const now = FIXTURE_END + 60;
    const summaries = new SummaryService(db, () => new MockProvider(), { language: 'Turkish' }, () => now);
    const app = buildApi({ db, apiToken: TOKEN, pairing: () => ({ status: 'open', qr: null, pairingCode: null, me: null }), requestPairingCode: async () => 'X', summaries });
    const auth = { authorization: `Bearer ${TOKEN}` };
    return { db, app, auth };
  }

  it('POST /summaries returns the structured summary and stores it', async () => {
    const { app, auth } = setup();
    const res = await app.inject({ method: 'POST', url: '/summaries', headers: auth, payload: {} });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.ok(SummarySchema.safeParse(body).success);
    assert.equal(typeof body.id, 'number');
    assertGrounded(body);

    const list = (await app.inject({ url: '/summaries', headers: auth })).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, body.id);
    assert.equal(list[0].status, 'ok');
    assert.equal(list[0].must_not_miss_count, body.must_not_miss.length);
    assert.equal(list[0].chat_count, 3);

    const one = (await app.inject({ url: `/summaries/${body.id}`, headers: auth })).json();
    assert.deepEqual(one.must_not_miss, body.must_not_miss);
    assert.equal(one.overall, body.overall);
    assert.equal((await app.inject({ url: '/summaries/999', headers: auth })).statusCode, 404);
  });

  it('POST /summaries accepts since/until/chat_ids and rejects bad input', async () => {
    const { app, auth } = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/summaries',
      headers: auth,
      payload: { since: RANGE.since, until: RANGE.until, chat_ids: [FAMILY] },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json().per_chat.map((c: { chat: string }) => c.chat), ['Aile']);
    assert.deepEqual(res.json().range, RANGE);

    for (const payload of [{ since: 'yesterday' }, { since: RANGE.until, until: RANGE.since }, { chat_ids: 'x' }]) {
      const bad = await app.inject({ method: 'POST', url: '/summaries', headers: auth, payload });
      assert.equal(bad.statusCode, 400, JSON.stringify(payload));
    }
    assert.equal((await app.inject({ method: 'POST', url: '/summaries', payload: {} })).statusCode, 401);
  });

  it('GET /chats counts messages from others since the last summary', async () => {
    const { app, auth } = setup();
    const before = (await app.inject({ url: '/chats', headers: auth })).json();
    const byName = Object.fromEntries(before.map((c: { name: string; unread_since_last_summary: number }) => [c.name, c.unread_since_last_summary]));
    // Messages from others: Aile 17 of 18, Proje Ekibi 17 of 18, Ayşe 12 of 14.
    assert.deepEqual(byName, { Aile: 17, 'Proje Ekibi': 17, Ayşe: 12 });
    assert.equal(before[0].is_group, true);

    await app.inject({ method: 'POST', url: '/summaries', headers: auth, payload: {} });
    const after = (await app.inject({ url: '/chats', headers: auth })).json();
    assert.ok(after.every((c: { unread_since_last_summary: number }) => c.unread_since_last_summary === 0));
  });

  it('reports missing provider configuration as 503', async () => {
    const db = seededDb();
    const summaries = new SummaryService(
      db,
      () => createProvider({ provider: 'anthropic', model: undefined, language: 'Turkish', anthropicApiKey: undefined, openaiApiKey: undefined, maxRpm: undefined, ownerName: undefined }),
      { language: 'Turkish' },
    );
    const app = buildApi({ db, apiToken: TOKEN, pairing: () => ({ status: 'open', qr: null, pairingCode: null, me: null }), requestPairingCode: async () => 'X', summaries });
    const res = await app.inject({ method: 'POST', url: '/summaries', headers: { authorization: `Bearer ${TOKEN}` }, payload: {} });
    assert.equal(res.statusCode, 503);
    assert.match(res.json().error, /ANTHROPIC_API_KEY/);
  });
});

describe('providers', () => {
  const req = { system: 'sys', user: 'usr', schemaName: 'chat_summary', jsonSchema: { type: 'object' } };

  it('createProvider selects by SUMMARY_PROVIDER and validates config', () => {
    const base = { language: 'Turkish', anthropicApiKey: 'a', openaiApiKey: 'o', maxRpm: undefined, ownerName: undefined };
    assert.equal(createProvider({ ...base, provider: 'anthropic', model: undefined }).model, 'claude-opus-5-5');
    assert.equal(createProvider({ ...base, provider: 'openai', model: 'gemini-x' }).name, 'openai');
    assert.throws(() => createProvider({ ...base, provider: 'openai', model: undefined }), ProviderConfigError);
    assert.throws(() => createProvider({ ...base, provider: 'gemini', model: 'x' }), ProviderConfigError);
  });

  function fakeAnthropic(response: object) {
    const sent: Record<string, unknown>[] = [];
    const client = { beta: { messages: { create: async (body: Record<string, unknown>) => (sent.push(body), response) } } };
    return { client: client as unknown as Anthropic, sent };
  }

  it('Anthropic: sends the JSON schema as output_config.format and returns the text', async () => {
    const { client, sent } = fakeAnthropic({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"a":1}' }] });
    const out = await new AnthropicProvider('claude-opus-5-5', 'k', client).complete(req);
    assert.equal(out, '{"a":1}');
    assert.deepEqual(sent[0].output_config, { format: { type: 'json_schema', schema: { type: 'object' } } });
    assert.equal(sent[0].system, 'sys');
    assert.deepEqual(sent[0].messages, [{ role: 'user', content: 'usr' }]);
    assert.equal(sent[0].fallbacks, 'default');
    assert.deepEqual(sent[0].betas, ['server-side-fallback-2026-07-01']);
  });

  it('Anthropic: no fallback for models without it; refusals throw', async () => {
    const ok = fakeAnthropic({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] });
    await new AnthropicProvider('claude-haiku-5-5', 'k', ok.client).complete(req);
    assert.equal(ok.sent[0].fallbacks, undefined);

    const refused = fakeAnthropic({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] });
    await assert.rejects(new AnthropicProvider('claude-opus-5-5', 'k', refused.client).complete(req), ProviderRefusalError);
  });

  it('OpenAI: uses a strict json_schema response_format', async () => {
    const sent: Record<string, unknown>[] = [];
    const respond = (message: object) =>
      ({ chat: { completions: { create: async (b: Record<string, unknown>) => (sent.push(b), { choices: [{ message }] }) } } }) as unknown as OpenAI;

    const out = await new OpenAIProvider('gemini-x', 'k', respond({ content: '{"b":2}', refusal: null })).complete(req);
    assert.equal(out, '{"b":2}');
    assert.deepEqual(sent[0].response_format, {
      type: 'json_schema',
      json_schema: { name: 'chat_summary', schema: { type: 'object' }, strict: true },
    });
    assert.deepEqual(sent[0].messages, [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ]);
    await assert.rejects(
      new OpenAIProvider('gemini-x', 'k', respond({ content: null, refusal: 'no' })).complete(req),
      ProviderRefusalError,
    );
  });
});

describe('RateLimitedProvider', () => {
  function fakeClock() {
    let t = 1_000_000;
    const sleeps: number[] = [];
    return { sleeps, clock: { now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; } } };
  }
  const req = { system: 's', user: 'u', schemaName: 'x', jsonSchema: {} };

  it('spaces request starts to stay under the per-minute cap', async () => {
    const starts: number[] = [];
    const inner: SummaryProvider = { name: 'm', model: 'mock-1', complete: async () => (starts.push(Date.now()), '{}') };
    // Real clock with a 40 ms interval instead of 12 s.
    const limited = new RateLimitedProvider(inner, 5, { now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }, 40);
    const before = Date.now();
    await Promise.all([1, 2, 3].map(() => limited.complete(req)));
    assert.equal(starts.length, 3);
    // Call i may not start before i intervals have passed (timers can fire ~1 ms early).
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - before >= i * 40 - 2, `call ${i} at ${starts[i] - before}ms`);
    assert.equal(limited.model, 'mock-1');
  });

  it('waits a minute and retries once on 429/503, but not on other errors', async () => {
    const { sleeps, clock } = fakeClock();
    let calls = 0;
    const flaky: SummaryProvider = {
      name: 'f', model: 'f',
      complete: async () => {
        calls++;
        if (calls === 1) throw Object.assign(new Error('quota'), { status: 429 });
        if (calls === 3) throw Object.assign(new Error('busy'), { status: 503 });
        if (calls === 5) throw Object.assign(new Error('bad'), { status: 400 });
        return '{}';
      },
    };
    const limited = new RateLimitedProvider(flaky, 5, clock);
    assert.equal(await limited.complete(req), '{}');
    assert.equal(calls, 2);
    assert.ok(sleeps.includes(60_000));
    assert.equal(await limited.complete(req), '{}');
    assert.equal(calls, 4);
    await assert.rejects(limited.complete(req), /bad/);
    assert.equal(calls, 5);
  });

  it('is applied by createProvider when SUMMARY_MAX_RPM is set', () => {
    const p = createProvider({ provider: 'openai', model: 'gemini-x', language: 'Turkish', anthropicApiKey: undefined, openaiApiKey: 'o', maxRpm: 5, ownerName: undefined });
    assert.ok(p instanceof RateLimitedProvider);
    assert.equal(p.name, 'openai');
  });
});
