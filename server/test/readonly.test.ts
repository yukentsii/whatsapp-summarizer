import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WASocket } from '@whiskeysockets/baileys';
import { lockDownSocket } from '../src/whatsapp.js';

describe('lockDownSocket', () => {
  it('replaces every sending/read/presence method with a throwing stub', () => {
    const calls: string[] = [];
    const names = ['sendMessage', 'readMessages', 'sendReceipt', 'sendReceipts', 'sendPresenceUpdate', 'chatModify'];
    const fake = Object.fromEntries([
      ...names.map((n) => [n, () => calls.push(n)]),
      ['groupFetchAllParticipating', () => 'ok'],
    ]) as unknown as WASocket;

    lockDownSocket(fake);

    for (const n of names) {
      assert.throws(() => (fake as unknown as Record<string, () => void>)[n](), /read-only mode/, n);
    }
    assert.deepEqual(calls, []);
    assert.equal((fake as unknown as { groupFetchAllParticipating: () => string }).groupFetchAllParticipating(), 'ok');
  });
});
