import type { StructuredRequest, SummaryProvider } from '../../src/summary/provider.js';

export const INVENTED_ID = 'INVENTED-404';

/**
 * Deterministic stand-in for a model. It flags lines by simple keyword rules, always
 * adds one invented message id (which the pipeline must drop), and can return broken
 * output for the first N calls to exercise the retry.
 */
export class MockProvider implements SummaryProvider {
  readonly name = 'mock';
  readonly model = 'mock-1';
  readonly calls: StructuredRequest[] = [];

  constructor(private readonly opts: { badResponses?: Array<'not-json' | 'wrong-shape'> } = {}) {}

  callsFor(schemaName: string) {
    return this.calls.filter((c) => c.schemaName === schemaName);
  }

  async complete(req: StructuredRequest): Promise<string> {
    this.calls.push(req);
    const bad = this.opts.badResponses?.shift();
    if (bad === 'not-json') return 'Here is your summary: {oops';
    if (bad === 'wrong-shape') return JSON.stringify({ brief: 42, overall: null });

    switch (req.schemaName) {
      case 'chat_summary':
        return JSON.stringify(this.chatSummary(req.user));
      case 'merged_brief':
        return JSON.stringify({ brief: 'Birleştirilmiş özet' });
      case 'overall_summary':
        return JSON.stringify({ overall: 'Genel özet: dikkat edilmesi gerekenler var.' });
      default:
        throw new Error(`unexpected schema ${req.schemaName}`);
    }
  }

  private chatSummary(user: string) {
    const lines = user
      .split('\n')
      .map((l) => /^\[([^\]]+)\] \S+ \S+ (\S+)( \([^)]*\))?: (.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map(([, id, sender, flags = '', text]) => ({ id, sender, flags, text }));
    const fromOthers = lines.filter((l) => l.sender !== 'ME');
    const item = (id: string, reason: string) => ({ message_id: id, reason });

    return {
      brief: `${lines.length} mesaj özetlendi`,
      must_not_miss: [
        ...fromOthers.filter((l) => /acil|son gün/i.test(l.text) || /\bTL\b/.test(l.text)).map((l) => item(l.id, 'Önemli')),
        item(INVENTED_ID, 'Uydurma'),
      ],
      // Overeager on purpose: every question, plus the first message of each chat as a "mention".
      questions_to_me: fromOthers.filter((l) => l.text.includes('?')).map((l) => item(l.id, 'Soru')),
      mentions_of_me: [
        ...fromOthers.filter((l) => /mentions ME|names ME/.test(l.flags)).map((l) => item(l.id, 'Etiketlendin')),
        ...(fromOthers[0] && !/ME/.test(fromOthers[0].flags) ? [item(fromOthers[0].id, 'Uydurma')] : []),
      ],
      dates_and_plans: lines
        .filter((l) => /yarın|cumartesi|saat \d|\d{1,2}:\d{2}/i.test(l.text))
        .map((l) => ({ what: l.text.slice(0, 40), when: 'mesajdaki tarih', message_id: l.id })),
    };
  }
}
