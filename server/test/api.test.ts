import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApi } from '../src/api.js';
import { openDb } from '../src/db.js';
import { SummaryService } from '../src/summary/service.js';
import { PairingUnavailableError, type PairingState } from '../src/whatsapp.js';

const TOKEN = 'test-token-0123456789';

function setup(pairing: PairingState, requestPairingCode: (phone: string) => Promise<string> = async () => 'ABCD1234') {
  const db = openDb(':memory:');
  const summaries = new SummaryService(db, () => {
    throw new Error('not used');
  }, { language: 'Turkish' });
  const app = buildApi({ db, apiToken: TOKEN, pairing: () => pairing, requestPairingCode, summaries });
  return { db, app };
}

describe('api', () => {
  it('rejects requests without a valid bearer token', async () => {
    const { app, db } = setup({ status: 'open', qr: null, pairingCode: null, me: null });
    for (const authorization of [undefined, 'Bearer wrong', `Basic ${TOKEN}`, `Bearer ${TOKEN}x`]) {
      const res = await app.inject({ url: '/status', headers: authorization ? { authorization } : {} });
      assert.equal(res.statusCode, 401, String(authorization));
    }
    await app.close();
    db.close();
  });

  it('returns status with message stats', async () => {
    const { app, db } = setup({ status: 'open', qr: null, pairingCode: null, me: '905550000000@s.whatsapp.net' });
    db.upsertMessages([
      {
        id: 'A1', chat_id: 'c', chat_name: null, is_group: false, sender_id: null, sender_name: null,
        from_me: false, timestamp: 1_760_000_000, text: 'x', message_type: 'conversation',
        quoted_message_id: null, mentions_me: false, replies_to_me: false,
      },
    ]);
    const res = await app.inject({ url: '/status', headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {
      connection: 'open',
      me: '905550000000@s.whatsapp.net',
      message_count: 1,
      last_message_time: new Date(1_760_000_000_000).toISOString(),
    });
    await app.close();
    db.close();
  });

  it('returns pairing state', async () => {
    const { app, db } = setup({
      status: 'awaiting_pairing',
      qr: 'data:image/png;base64,AAAA',
      pairingCode: 'ABCD1234',
      me: null,
    });
    const res = await app.inject({ url: '/pairing', headers: { authorization: `Bearer ${TOKEN}` } });
    assert.deepEqual(res.json(), {
      status: 'awaiting_pairing',
      qr: 'data:image/png;base64,AAAA',
      pairing_code: 'ABCD1234',
    });
    await app.close();
    db.close();
  });

  it('POST /pairing/code returns a code for a valid phone number', async () => {
    const phones: string[] = [];
    const { app, db } = setup({ status: 'awaiting_pairing', qr: null, pairingCode: null, me: null }, async (p) => {
      phones.push(p);
      return 'WXYZ5678';
    });
    const auth = { authorization: `Bearer ${TOKEN}` };
    const res = await app.inject({ method: 'POST', url: '/pairing/code', headers: auth, payload: { phone: '+90 555 123 45 67' } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { pairing_code: 'WXYZ5678' });
    assert.deepEqual(phones, ['+90 555 123 45 67']);
    const bad = await app.inject({ method: 'POST', url: '/pairing/code', headers: auth, payload: { phone: 'abc' } });
    assert.equal(bad.statusCode, 400);
    await app.close();
    db.close();
  });

  it('POST /pairing/code returns 409 when already paired', async () => {
    const { app, db } = setup({ status: 'open', qr: null, pairingCode: null, me: null }, async () => {
      throw new PairingUnavailableError('cannot request a pairing code while open');
    });
    const res = await app.inject({
      method: 'POST', url: '/pairing/code', headers: { authorization: `Bearer ${TOKEN}` }, payload: { phone: '905551234567' },
    });
    assert.equal(res.statusCode, 409);
    await app.close();
    db.close();
  });
});
