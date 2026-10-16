import type { SummaryConfig } from '../config.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import type { SummaryProvider } from './provider.js';
import { RateLimitedProvider } from './rate-limit.js';

export class ProviderConfigError extends Error {}

export function createProvider(cfg: SummaryConfig): SummaryProvider {
  if (!cfg.maxRpm) return createBaseProvider(cfg);
  return new RateLimitedProvider(createBaseProvider(cfg, 0), cfg.maxRpm);
}

function createBaseProvider(cfg: SummaryConfig, maxRetries?: number): SummaryProvider {
  switch (cfg.provider) {
    case 'anthropic':
      if (!cfg.anthropicApiKey) throw new ProviderConfigError('ANTHROPIC_API_KEY is not set');
      return new AnthropicProvider(cfg.model ?? 'claude-opus-5-5', cfg.anthropicApiKey, undefined, maxRetries);
    case 'openai':
      if (!cfg.openaiApiKey) throw new ProviderConfigError('OPENAI_API_KEY is not set');
      if (!cfg.model) throw new ProviderConfigError('SUMMARY_MODEL must be set for the openai provider');
      return new OpenAIProvider(cfg.model, cfg.openaiApiKey, undefined, maxRetries);
    default:
      throw new ProviderConfigError(`unknown SUMMARY_PROVIDER "${cfg.provider}" (expected anthropic or openai)`);
  }
}
