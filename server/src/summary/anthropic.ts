import Anthropic from '@anthropic-ai/sdk';
import { ProviderRefusalError, type StructuredRequest, type SummaryProvider } from './provider.js';

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

export class AnthropicProvider implements SummaryProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(
    readonly model: string,
    apiKey: string,
    client?: Anthropic,
    /** SDK-level retries; 0 when RateLimitedProvider does the retrying, so retries don't eat the quota. */
    maxRetries?: number,
  ) {
    this.client = client ?? new Anthropic({ apiKey, maxRetries });
  }

  async complete(req: StructuredRequest): Promise<string> {
    const fallback = FALLBACK_MODELS.has(this.model);
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      output_config: { format: { type: 'json_schema', schema: req.jsonSchema } },
      ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });
    if (response.stop_reason === 'refusal') {
      throw new ProviderRefusalError(`model refused (${response.stop_details?.category ?? 'unknown'})`);
    }
    return response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
}
