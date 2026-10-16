import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WAMessage } from '@whiskeysockets/baileys';
import { parseMessage, toUnixSeconds, type ParseContext } from '../src/parse.js';

const ME_PN = '905550000000@s.whatsapp.net';
const ME_LID = '111111111111111@lid';
const ALICE = '905551111111@s.whatsapp.net';
const BOB = '905552222222@s.whatsapp.net';
const GROUP = '120363000000000000@g.us';

function ctx(overrides: Partial<ParseContext> = {}): ParseContext {
  return {
    myIds: new Set([ME_PN, ME_LID]),
    chatName: (id) => (id === GROUP ? 'Family' : null),
    isFromMe: () => false,
    ...overrides,
  };
}

function msg(partial: Partial<WAMessage>): WAMessage {
  return { messageTimestamp: 1_760_000_000, ...partial } as WAMessage;
}

describe('parseMessage', () => {
  it('parses a plain 1:1 text message', () => {
    const row = parseMessage(
      msg({ key: { remoteJid: ALICE, id: 'A1', fromMe: false }, pushName: 'Alice', message: { conversation: 'Selam' } }),
      ctx(),
    );
    assert.deepEqual(row, {
      id: 'A1',
      chat_id: ALICE,
      chat_name: 'Alice',
      is_group: false,
      sender_id: ALICE,
      sender_name: 'Alice',
      from_me: false,
      timestamp: 1_760_000_000,
      text: 'Selam',
      message_type: 'conversation',
      quoted_message_id: null,
      mentions_me: false,
      replies_to_me: false,
    });
  });

  it('marks my own messages and uses my phone JID as sender', () => {
    const row = parseMessage(
      msg({ key: { remoteJid: ALICE, id: 'M1', fromMe: true }, message: { conversation: 'hi' } }),
      ctx(),
    )!;
    assert.equal(row.from_me, true);
    assert.equal(row.sender_id, ME_PN);
    assert.equal(row.sender_name, null);
    assert.equal(row.chat_name, null);
  });

  it('detects replies to me via the quoted participant', () => {
    const row = parseMessage(
      msg({
        key: { remoteJid: GROUP, id: 'G1', fromMe: false, participant: BOB },
        pushName: 'Bob',
        message: {
          extendedTextMessage: {
            text: 'evet, saat kaçta?',
            contextInfo: { stanzaId: 'M1', participant: ME_PN },
          },
        },
      }),
      ctx(),
    )!;
    assert.equal(row.is_group, true);
    assert.equal(row.chat_name, 'Family');
    assert.equal(row.sender_id, BOB);
    assert.equal(row.quoted_message_id, 'M1');
    assert.equal(row.replies_to_me, true);
    assert.equal(row.mentions_me, false);
  });

  it('detects replies to me via a stored from_me message', () => {
    const row = parseMessage(
      msg({
        key: { remoteJid: GROUP, id: 'G2', fromMe: false, participant: BOB },
        message: { extendedTextMessage: { text: 'ok', contextInfo: { stanzaId: 'MINE', participant: '999@lid' } } },
      }),
      ctx({ isFromMe: (id) => id === 'MINE' }),
    )!;
    assert.equal(row.replies_to_me, true);
  });

  it('does not flag replies to someone else', () => {
    const row = parseMessage(
      msg({
        key: { remoteJid: GROUP, id: 'G3', fromMe: false, participant: BOB },
        message: { extendedTextMessage: { text: 'ok', contextInfo: { stanzaId: 'X', participant: ALICE } } },
      }),
      ctx(),
    )!;
    assert.equal(row.replies_to_me, false);
  });

  it('detects @mentions of my phone JID and my LID', () => {
    for (const mentioned of [ME_PN, '111111111111111:12@lid']) {
      const row = parseMessage(
        msg({
          key: { remoteJid: GROUP, id: `MEN-${mentioned}`, fromMe: false, participant: BOB },
          message: { extendedTextMessage: { text: '@ben bakar mısın', contextInfo: { mentionedJid: [mentioned] } } },
        }),
        ctx(),
      )!;
      assert.equal(row.mentions_me, true, mentioned);
    }
  });

  it('stores media type and caption only', () => {
    const row = parseMessage(
      msg({
        key: { remoteJid: ALICE, id: 'IMG', fromMe: false },
        message: { imageMessage: { caption: 'fatura ekte', url: 'https://mmg.whatsapp.net/x', mimetype: 'image/jpeg' } },
      }),
      ctx(),
    )!;
    assert.equal(row.message_type, 'imageMessage');
    assert.equal(row.text, 'fatura ekte');

    const audio = parseMessage(
      msg({ key: { remoteJid: ALICE, id: 'AUD', fromMe: false }, message: { audioMessage: { seconds: 5 } } }),
      ctx(),
    )!;
    assert.equal(audio.message_type, 'audioMessage');
    assert.equal(audio.text, null);
  });

  it('unwraps ephemeral and view-once wrappers', () => {
    const eph = parseMessage(
      msg({
        key: { remoteJid: ALICE, id: 'E1', fromMe: false },
        message: { ephemeralMessage: { message: { extendedTextMessage: { text: 'kaybolan' } } } },
      }),
      ctx(),
    )!;
    assert.equal(eph.message_type, 'extendedTextMessage');
    assert.equal(eph.text, 'kaybolan');

    const vo = parseMessage(
      msg({
        key: { remoteJid: ALICE, id: 'V1', fromMe: false },
        message: { viewOnceMessageV2: { message: { videoMessage: { caption: 'bir kez' } } } },
      }),
      ctx(),
    )!;
    assert.equal(vo.message_type, 'videoMessage');
    assert.equal(vo.text, 'bir kez');
  });

  it('skips status broadcasts, reactions, protocol messages and stubs', () => {
    const c = ctx();
    assert.equal(
      parseMessage(msg({ key: { remoteJid: 'status@broadcast', id: 'S1', participant: ALICE }, message: { conversation: 'x' } }), c),
      null,
    );
    assert.equal(
      parseMessage(
        msg({ key: { remoteJid: ALICE, id: 'R1' }, message: { reactionMessage: { text: '👍', key: { id: 'A1' } } } }),
        c,
      ),
      null,
    );
    assert.equal(
      parseMessage(msg({ key: { remoteJid: ALICE, id: 'P1' }, message: { protocolMessage: { type: 0 } } }), c),
      null,
    );
    assert.equal(parseMessage(msg({ key: { remoteJid: GROUP, id: 'STUB' }, messageStubType: 20 }), c), null);
    assert.equal(parseMessage(msg({ key: { remoteJid: ALICE }, message: { conversation: 'no id' } }), c), null);
  });

  it('prefers the phone-number JID over a LID for 1:1 chats and group senders', () => {
    const dm = parseMessage(
      msg({
        key: { remoteJid: '222@lid', remoteJidAlt: ALICE, id: 'L1', fromMe: false },
        message: { conversation: 'x' },
      }),
      ctx(),
    )!;
    assert.equal(dm.chat_id, ALICE);
    assert.equal(dm.sender_id, ALICE);

    const grp = parseMessage(
      msg({
        key: { remoteJid: GROUP, id: 'L2', fromMe: false, participant: '333@lid', participantAlt: BOB },
        message: { conversation: 'x' },
      }),
      ctx(),
    )!;
    assert.equal(grp.chat_id, GROUP);
    assert.equal(grp.sender_id, BOB);
  });

  it('reads the group sender from msg.participant for history-sync messages', () => {
    const row = parseMessage(
      msg({ key: { remoteJid: GROUP, id: 'H1', fromMe: false }, participant: '444@lid', message: { conversation: 'eski mesaj' } }),
      ctx({ chatName: (id) => (id === GROUP ? 'Family' : id === '444@lid' ? 'Lid Contact' : null) }),
    )!;
    assert.equal(row.sender_id, '444@lid');
    assert.equal(row.sender_name, 'Lid Contact');
  });

  it('falls back to a known contact name for group senders without a push name', () => {
    const row = parseMessage(
      msg({ key: { remoteJid: GROUP, id: 'N1', fromMe: false, participant: BOB }, message: { conversation: 'x' } }),
      ctx({ chatName: (id) => (id === GROUP ? 'Family' : id === BOB ? 'Bob Saved' : null) }),
    )!;
    assert.equal(row.sender_name, 'Bob Saved');
  });
});

describe('toUnixSeconds', () => {
  it('handles numbers, Long-like objects and null', () => {
    assert.equal(toUnixSeconds(1_700_000_000), 1_700_000_000);
    assert.equal(toUnixSeconds({ toString: () => '1700000001' } as never), 1_700_000_001);
    assert.equal(toUnixSeconds(null), 0);
  });
});
