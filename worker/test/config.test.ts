import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const valid = {
  DATABASE_URL: "postgresql://u:p@h/db",
  TG_API_ID: "12345",
  TG_API_HASH: "abcdef",
  SESSION_ENC_KEY: "a".repeat(64),
  INGEST_URL: "https://crm.example.com/api/ingest",
  INGEST_SECRET: "s1",
  WORKER_SECRET: "s2",
};

describe("loadConfig", () => {
  it("читает корректный env, PORT по умолчанию 8787", () => {
    const c = loadConfig(valid);
    expect(c.port).toBe(8787);
    expect(c.tgApiId).toBe(12345);
    expect(c.sessionEncKey).toHaveLength(32);
  });

  it("START_DELAY_MS по умолчанию 20 секунд, можно задать 0", () => {
    expect(loadConfig(valid).startDelayMs).toBe(20_000);
    expect(loadConfig({ ...valid, START_DELAY_MS: "0" }).startDelayMs).toBe(0);
  });

  it("PORT из env", () => {
    expect(loadConfig({ ...valid, PORT: "3000" }).port).toBe(3000);
  });

  it("перечисляет все проблемы сразу", () => {
    const { DATABASE_URL: _d, WORKER_SECRET: _w, ...rest } = valid;
    expect(() => loadConfig({ ...rest, SESSION_ENC_KEY: "short" })).toThrow(
      /DATABASE_URL[\s\S]*SESSION_ENC_KEY[\s\S]*WORKER_SECRET/,
    );
  });

  it("пустая строка считается незаданной", () => {
    expect(() => loadConfig({ ...valid, TG_API_HASH: "" })).toThrow(/TG_API_HASH/);
  });

  it("отвергает нечисловой TG_API_ID и кривой INGEST_URL", () => {
    expect(() => loadConfig({ ...valid, TG_API_ID: "abc" })).toThrow(/TG_API_ID/);
    expect(() => loadConfig({ ...valid, INGEST_URL: "не url" })).toThrow(/INGEST_URL/);
  });
});
