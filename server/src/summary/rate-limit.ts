import type { StructuredRequest, SummaryProvider } from './provider.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Spaces request starts so at most `maxRpm` begin per minute (for free-tier quotas),
 * and retries once after a minute if the provider answers 429 (quota) or 503 (overloaded).
 */
export class RateLimitedProvider implements SummaryProvider {
  readonly name: string;
  readonly model: string;
  private nextSlot = 0;

  constructor(
    private readonly inner: SummaryProvider,
    maxRpm: number,
    private readonly clock: { now: () => number; sleep: (ms: number) => Promise<void> } = { now: Date.now, sleep },
    private readonly intervalMs = Math.ceil(60_000 / maxRpm),
  ) {
    this.name = inner.name;
    this.model = inner.model;
  }

  private async waitForSlot() {
    const now = this.clock.now();
    const start = Math.max(now, this.nextSlot);
    this.nextSlot = start + this.intervalMs;
    if (start > now) await this.clock.sleep(start - now);
  }

  async complete(req: StructuredRequest): Promise<string> {
    await this.waitForSlot();
    try {
      return await this.inner.complete(req);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 429 && status !== 503) throw err;
      await this.clock.sleep(60_000);
      this.nextSlot = Math.max(this.nextSlot, this.clock.now() + this.intervalMs);
      return this.inner.complete(req);
    }
  }
}
