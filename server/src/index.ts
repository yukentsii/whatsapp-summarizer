import { buildApi } from './api.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createProvider } from './summary/factory.js';
import { SummaryService } from './summary/service.js';
import { WhatsAppIngestor } from './whatsapp.js';

const config = loadConfig();
const db = openDb(config.dbPath);

let ingestor: WhatsAppIngestor | undefined;
// Built once so the rate limiter's pacing carries across summaries.
let provider: ReturnType<typeof createProvider> | undefined;
const summaries = new SummaryService(db, () => (provider ??= createProvider(config.summary)), {
  language: config.summary.language,
  ownerName: config.summary.ownerName,
});
const app = buildApi(
  {
    db,
    apiToken: config.apiToken,
    pairing: () => ingestor!.state,
    requestPairingCode: (phone) => ingestor!.requestPairingCode(phone),
    summaries,
  },
  {
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization'],
    },
  },
);

// Baileys logs raw message payloads at debug/trace, so it is capped at warn regardless of LOG_LEVEL.
const waLogger = app.log.child({ module: 'whatsapp' });
const baileysLogger = app.log.child({ module: 'baileys' }, { level: 'warn' });
ingestor = new WhatsAppIngestor(db, config.authDir, waLogger, baileysLogger, config.pairingPhone);

const shutdown = async () => {
  ingestor?.stop();
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
await ingestor.start();
