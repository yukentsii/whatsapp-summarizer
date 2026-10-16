import type { Db } from '../db.js';
import { summarize, type PipelineOptions } from './pipeline.js';
import type { SummaryProvider } from './provider.js';
import { SummarySchema, type Summary } from './schema.js';

/** Used as the start of the very first summary, when there is no previous one. */
export const FIRST_SUMMARY_LOOKBACK_SECONDS = 24 * 60 * 60;

export interface SummaryRequest {
  since?: number;
  until?: number;
  chat_ids?: string[];
}

export interface SummaryRecord extends Summary {
  id: number;
  created_at: string;
  provider: string;
  model: string;
  chat_ids: string[] | null;
}

export class SummaryInProgressError extends Error {}

export class SummaryService {
  private running = false;

  constructor(
    private readonly db: Db,
    private readonly getProvider: () => SummaryProvider,
    private readonly opts: PipelineOptions,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  /** Start of the default range: the end of the last successful summary, or 24h ago. */
  defaultSince(): number {
    return this.db.lastSummaryUntil() ?? this.now() - FIRST_SUMMARY_LOOKBACK_SECONDS;
  }

  async run(req: SummaryRequest): Promise<SummaryRecord> {
    if (this.running) throw new SummaryInProgressError('a summary is already being generated');
    this.running = true;
    try {
      return await this.runUnlocked(req);
    } finally {
      this.running = false;
    }
  }

  private async runUnlocked(req: SummaryRequest): Promise<SummaryRecord> {
    const provider = this.getProvider();
    const until = req.until ?? this.now();
    const since = req.since ?? this.defaultSince();
    const chatIds = req.chat_ids?.length ? req.chat_ids : null;
    const range = { since: iso(since), until: iso(until) };
    const createdAt = this.now();
    const base = {
      created_at: createdAt,
      range_since: since,
      range_until: until,
      chat_ids: chatIds,
      provider: provider.name,
      model: provider.model,
    };

    try {
      const messages = this.db.messagesInRange(since, until, chatIds);
      const summary = SummarySchema.parse(await summarize(provider, messages, range, this.opts));
      const id = this.db.insertSummary({ ...base, status: 'ok', result_json: JSON.stringify(summary), error: null });
      return { id, created_at: iso(createdAt), provider: provider.name, model: provider.model, chat_ids: chatIds, ...summary };
    } catch (err) {
      this.db.insertSummary({ ...base, status: 'error', result_json: null, error: (err as Error).message });
      throw err;
    }
  }
}

export const iso = (unix: number) => new Date(unix * 1000).toISOString();
