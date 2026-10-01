import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Общий тип БД: прод (postgres.js → Neon) и тесты (PGlite) оба ему соответствуют.
 * Функции доступа к данным принимают `db: Db` параметром, а не импортируют глобальный клиент, —
 * так их можно тестировать на PGlite без сети.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let cached: PostgresJsDatabase<typeof schema> | undefined;

/** Ленивый синглтон: на этапе `next build` переменных окружения может не быть. */
export function getDb(): Db {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // prepare: false — совместимо с пулером Neon (pgbouncer); max: 1 — одна serverless-функция = одно соединение.
    const client = postgres(url, { prepare: false, max: 1 });
    cached = drizzle(client, { schema });
  }
  return cached as unknown as Db;
}

export { schema };
