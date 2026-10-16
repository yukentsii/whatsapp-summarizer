import OpenAI from 'openai';
import { ProviderRefusalError, type StructuredRequest, type SummaryProvider } from './provider.js';

/**
 * Uses Chat Completions with a strict JSON schema. Also works with OpenAI-compatible
 * endpoints (e.g. Gemini) when OPENAI_BASE_URL is set.
 */
export class OpenAIProvider implements SummaryProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;

  constructor(
    readonly model: string,
    apiKey: string,
    client?: OpenAI,
    /** SDK-level retries; 0 when RateLimitedProvider does the retrying, so retries don't eat the quota. */
    maxRetries?: number,
  ) {
    this.client = client ?? new OpenAI({ apiKey, timeout: 10 * 60 * 1000, maxRetries });
  }

  async complete(req: StructuredRequest): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: req.schemaName, schema: req.jsonSchema, strict: true },
      },
    });
    const message = response.choices[0]?.message;
    if (message?.refusal) throw new ProviderRefusalError('model refused');
    return message?.content ?? '';
  }
}
