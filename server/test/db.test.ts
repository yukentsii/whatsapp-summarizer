import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDb, type StoredMessage } from '../src/db.js';

function row(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id: 'A1',
    chat_id: '905551111111@s.whatsapp.net',
    chat_name: 'Alice',
    is_group: false,
    sender_id: '905551111111@s.whatsapp.net',
    sender_name: 'Alice',
    from_me: false,
    timestamp: 1_760_000_000,
    text: 'Selam',
    message_type: 'conversation',
    quoted_message_id: null,
    mentions_me: false,
    replies_to_me: false,
    ...overrides,
  };
}

describe('db', () => {
  it('inserts new messages and ignores duplicate ids', () => {
    const db = openDb(':memory:');
    assert.equal(db.upsertMessages([row()]), 1);
    assert.equal(db.upsertMessages([row({ text: 'changed' }), row({ id: 'A2', timestamp: 1_760_000_100 })]), 1);

    const stored = db.raw.prepare('SELECT text FROM messages WHERE id = ?').get('A1') as { text: string };
    assert.equal(stored.text, 'Selam');
    assert.deepEqual(db.stats(), { messageCount: 2, lastMessageTimestamp: 1_760_000_100 });
    db.close();
  });

  it('stores booleans as integers and round-trips nulls', () => {
    const db = openDb(':memory:');
    db.upsertMessages([row({ id: 'B1', from_me: true, mentions_me: true, replies_to_me: true, text: null })]);
    const r = db.raw.prepare('SELECT * FROM messages WHERE id = ?').get('B1') as Record<string, unknown>;
    assert.equal(r.from_me, 1);
    assert.equal(r.mentions_me, 1);
    assert.equal(r.replies_to_me, 1);
    assert.equal(r.is_group, 0);
    assert.equal(r.text, null);
    assert.equal(db.isFromMe('B1'), true);
    assert.equal(db.isFromMe('missing'), false);
    db.close();
  });

  it('reports empty stats', () => {
    const db = openDb(':memory:');
    assert.deepEqual(db.stats(), { messageCount: 0, lastMessageTimestamp: null });
    db.close();
  });

  it('upsertChat overwrites names, fillChatName only fills gaps', () => {
    const db = openDb(':memory:');
    db.fillChatName('c1', 'push name', false);
    assert.equal(db.chatName('c1'), 'push name');
    db.fillChatName('c1', 'other push name', false);
    assert.equal(db.chatName('c1'), 'push name');
    db.upsertChat('c1', 'Saved Name', false);
    assert.equal(db.chatName('c1'), 'Saved Name');
    db.upsertChat('c1', null, false);
    assert.equal(db.chatName('c1'), 'Saved Name');
    assert.equal(db.chatName('unknown'), null);
    db.close();
  });
});
