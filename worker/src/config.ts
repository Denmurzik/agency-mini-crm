import { z } from "zod";

const required = (name: string) => z.string({ error: `${name} не задан` }).min(1, `${name} не задан`);

const schema = z.object({
  DATABASE_URL: required("DATABASE_URL"),
  TG_API_ID: z.coerce.number({ error: "TG_API_ID должен быть числом" }).int().positive("TG_API_ID должен быть положительным числом"),
  TG_API_HASH: required("TG_API_HASH"),
  SESSION_ENC_KEY: z
    .string({ error: "SESSION_ENC_KEY не задан" })
    .regex(/^[0-9a-fA-F]{64}$/, "SESSION_ENC_KEY должен быть 64 hex-символа (32 байта): openssl rand -hex 32"),
  INGEST_URL: z.url({ error: "INGEST_URL должен быть корректным URL" }),
  INGEST_SECRET: required("INGEST_SECRET"),
  WORKER_SECRET: required("WORKER_SECRET"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  START_DELAY_MS: z.coerce.number().int().min(0).default(20_000),
});

export type Config = {
  databaseUrl: string;
  tgApiId: number;
  tgApiHash: string;
  sessionEncKey: Buffer;
  ingestUrl: string;
  ingestSecret: string;
  workerSecret: string;
  port: number;
  /** Пауза перед подключением к Telegram: старый контейнер при деплое должен успеть погаснуть. */
  startDelayMs: number;
};

/** Бросает Error с перечнем всех проблемных переменных сразу. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  // Пустая строка в .env = не задано
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.message}`);
    throw new Error(`Неверная конфигурация воркера:\n${lines.join("\n")}`);
  }
  const c = parsed.data;
  return {
    databaseUrl: c.DATABASE_URL,
    tgApiId: c.TG_API_ID,
    tgApiHash: c.TG_API_HASH,
    sessionEncKey: Buffer.from(c.SESSION_ENC_KEY, "hex"),
    ingestUrl: c.INGEST_URL,
    ingestSecret: c.INGEST_SECRET,
    workerSecret: c.WORKER_SECRET,
    port: c.PORT,
    startDelayMs: c.START_DELAY_MS,
  };
}
