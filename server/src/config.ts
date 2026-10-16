import path from 'node:path';

export interface Config {
  port: number;
  host: string;
  apiToken: string;
  dataDir: string;
  dbPath: string;
  authDir: string;
  pairingPhone: string | undefined;
  logLevel: string;
  summary: SummaryConfig;
}

export interface SummaryConfig {
  provider: string;
  model: string | undefined;
  language: string;
  /** Owner's first name, used to tell which group messages are addressed to the owner. */
  ownerName: string | undefined;
  anthropicApiKey: string | undefined;
  openaiApiKey: string | undefined;
  /** Optional cap on model requests started per minute. */
  maxRpm: number | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiToken = env.API_TOKEN ?? '';
  if (apiToken.length < 16) {
    throw new Error('API_TOKEN must be set and at least 16 characters long');
  }
  const dataDir = path.resolve(env.DATA_DIR ?? './data');
  const pairingPhone = env.PAIRING_PHONE?.replace(/\D/g, '') || undefined;
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    apiToken,
    dataDir,
    dbPath: path.join(dataDir, 'messages.db'),
    authDir: path.join(dataDir, 'auth'),
    pairingPhone,
    logLevel: env.LOG_LEVEL ?? 'info',
    // Summary settings are validated when a summary is requested, so ingestion runs without them.
    summary: {
      provider: env.SUMMARY_PROVIDER ?? 'anthropic',
      model: env.SUMMARY_MODEL || undefined,
      language: env.SUMMARY_LANGUAGE || 'Turkish',
      ownerName: env.OWNER_NAME?.trim() || undefined,
      anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
      openaiApiKey: env.OPENAI_API_KEY || undefined,
      maxRpm: Number(env.SUMMARY_MAX_RPM) > 0 ? Number(env.SUMMARY_MAX_RPM) : undefined,
    },
  };
}
