import type { StoredMessage } from '../../src/db.js';

export const ME = '905550000000@s.whatsapp.net';
export const FAMILY = '120363000000000001@g.us';
export const WORK = '120363000000000002@g.us';
export const AYSE = '905551111111@s.whatsapp.net';

const PEOPLE: Record<string, string> = {
  '905552222222@s.whatsapp.net': 'Anne',
  '905553333333@s.whatsapp.net': 'Baba',
  '905554444444@s.whatsapp.net': 'Can',
  '905555555555@s.whatsapp.net': 'Mehmet',
  '905556666666@s.whatsapp.net': 'Zeynep',
  '905557777777@s.whatsapp.net': 'Emre',
  [AYSE]: 'Ayşe',
};
const id = (name: string) => Object.keys(PEOPLE).find((k) => PEOPLE[k] === name)!;

export const CHAT_NAMES: Record<string, string> = { [FAMILY]: 'Aile', [WORK]: 'Proje Ekibi', [AYSE]: 'Ayşe' };

/** Start of the fixture: 2026-10-15 09:00 UTC. */
export const T0 = Date.UTC(2026, 9, 15, 9, 0) / 1000;

type Spec = [sender: string, text: string | null, extra?: Partial<StoredMessage>];

function chat(chatId: string, prefix: string, specs: Spec[], startMinute: number): StoredMessage[] {
  return specs.map(([sender, text, extra], i) => {
    const fromMe = sender === 'ME';
    return {
      id: `${prefix}${String(i + 1).padStart(2, '0')}`,
      chat_id: chatId,
      chat_name: CHAT_NAMES[chatId],
      is_group: chatId.endsWith('@g.us'),
      sender_id: fromMe ? ME : id(sender),
      sender_name: fromMe ? null : sender,
      from_me: fromMe,
      timestamp: T0 + (startMinute + i * 7) * 60,
      text,
      message_type: 'conversation',
      quoted_message_id: null,
      mentions_me: false,
      replies_to_me: false,
      ...extra,
    };
  });
}

const family = chat(
  FAMILY,
  'FAM',
  [
    ['Anne', 'Günaydın herkese'],
    ['Baba', 'Günaydın'],
    ['Can', 'Hafta sonu ne yapıyoruz?'],
    ['Anne', 'Cumartesi akşam yemeği bizde, saat 19:00'],
    ['Baba', 'Ben mangal yaparım'],
    ['Anne', '@Deniz cumartesi gelebilir misin?', { mentions_me: true }],
    ['Can', 'Ben gelirim'],
    ['Baba', 'Kira 15.000 TL, yarın son gün, unutmayın', { message_type: 'extendedTextMessage' }],
    ['Anne', null, { message_type: 'imageMessage' }],
    ['Anne', 'Bahçeden domatesler', { message_type: 'imageMessage' }],
    ['Can', '😂'],
    ['ME', 'Günaydın'],
    ['Baba', 'Deniz, arabanın muayenesi ne zaman?'],
    ['Can', 'Ayın 25inde'],
    ['Anne', 'Tatlıyı kim getiriyor?'],
    ['Can', 'Ben baklava alırım'],
    ['Baba', null, { message_type: 'audioMessage' }],
    ['Anne', 'Tamam o zaman, cumartesi görüşürüz'],
  ],
  0,
);

const work = chat(
  WORK,
  'WRK',
  [
    ['Mehmet', 'Sprint planlama toplantısı yarın saat 10:00'],
    ['Zeynep', 'Tamam'],
    ['ME', 'Raporu cuma gününe kadar bitiririm'],
    ['Emre', 'Rapor için veri setini paylaştım', { message_type: 'documentMessage' }],
    [
      'Mehmet',
      'Deniz, raporun taslağını perşembe görebilir miyiz?',
      { quoted_message_id: 'WRK03', replies_to_me: true, message_type: 'extendedTextMessage' },
    ],
    ['Zeynep', 'Müşteri demo tarihi değişti, 28 Ekim oldu'],
    ['Emre', 'Sunucu bakımı bu gece 23:00-01:00'],
    ['Mehmet', 'Bütçe onayı için 120.000 TL teklif geldi'],
    ['Zeynep', 'Acil: üretimde hata var, bakabilecek var mı?'],
    ['Emre', 'Ben bakıyorum'],
    ['Emre', 'Düzeldi, cache sorunuymuş'],
    ['Mehmet', 'Teşekkürler Emre'],
    ['Zeynep', 'Öğle yemeği?'],
    ['Emre', '12:30 gibi'],
    ['Mehmet', '@Deniz toplantı notlarını gönderir misin?', { mentions_me: true, message_type: 'extendedTextMessage' }],
    ['Zeynep', 'Yeni stajyer pazartesi başlıyor'],
    ['Emre', null, { message_type: 'stickerMessage' }],
    ['Mehmet', 'İyi akşamlar'],
  ],
  3,
);

const ayse = chat(
  AYSE,
  'AYS',
  [
    ['Ayşe', 'Selam! Nasılsın?'],
    ['ME', 'İyiyim sen?'],
    ['Ayşe', 'Ben de iyiyim. Akşam sinemaya gidelim mi?'],
    ['ME', 'Olur, saat kaçta?'],
    ['Ayşe', '20:30 seansı var'],
    ['Ayşe', 'Bilet alayım mı?'],
    ['Ayşe', 'Bu arada bana 250 TL borcun vardı, IBAN atıyorum'],
    ['Ayşe', 'TR00 0000 0000 0000 0000 0000 00'],
    ['Ayşe', 'Fatura ekte', { message_type: 'imageMessage' }],
    ['Ayşe', 'Acil arar mısın? Annemle ilgili'],
    ['Ayşe', 'Neyse sorun çözüldü'],
    ['Ayşe', 'Yarın kahvaltı?'],
    ['Ayşe', null, { message_type: 'audioMessage' }],
    ['Ayşe', 'Haber ver'],
  ],
  5,
);

export const FIXTURE: StoredMessage[] = [...family, ...work, ...ayse];

/** Contact / group names, as the chats table would hold them. */
export const FIXTURE_CHATS: Array<[id: string, name: string, isGroup: boolean]> = [
  [FAMILY, 'Aile', true],
  [WORK, 'Proje Ekibi', true],
  [AYSE, 'Ayşe', false],
  ...Object.entries(PEOPLE).map(([k, v]) => [k, v, false] as [string, string, boolean]),
];

/** End of the fixture plus a minute. */
export const FIXTURE_END = Math.max(...FIXTURE.map((m) => m.timestamp)) + 60;
