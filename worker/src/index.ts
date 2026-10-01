import { loadConfig } from "./config.js";
import { createHttpServer } from "./http.js";
import { sendIngest } from "./ingest-client.js";
import { logger } from "./log.js";
import { AccountManager } from "./manager.js";
import { createPgStore } from "./store.js";
import { createGramClientFactory } from "./tg.js";

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const store = createPgStore(config.databaseUrl);
const manager = new AccountManager({
  store,
  createClient: createGramClientFactory(config.tgApiId, config.tgApiHash, logger),
  ingest: (payload) => sendIngest(payload, { url: config.ingestUrl, secret: config.ingestSecret, logger }),
  encKey: config.sessionEncKey,
  logger,
});

const server = createHttpServer({ service: manager, secret: config.workerSecret, logger });
// HTTP поднимаем первым: /health должен отвечать, даже пока Telegram подключается.
server.listen(config.port, () => logger.info("HTTP API воркера запущен", { port: config.port }));

void manager.start();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Останавливаюсь", { signal });
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  server.close();
  await manager.stop().catch(() => undefined);
  await store.close().catch(() => undefined);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// GramJS иногда роняет необработанные отказы при обрыве сети; воркер должен жить.
process.on("unhandledRejection", (reason) => logger.error("unhandledRejection", { reason: String(reason).slice(0, 200) }));
