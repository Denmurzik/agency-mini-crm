import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import { leads } from "@/lib/db/schema";
import { createTestDb } from "@/test/db";

let db: Db;
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), getDb: () => db }));

import { POST } from "./route";

const body = {
  source: "telegram",
  name: "Пётр",
  contact: "@petr",
  request: "Привет!",
  tgUserId: 4242,
  tgUsername: "petr",
  message: { text: "Привет!", externalId: "1:2:3" },
};

const call = (payload: unknown, auth: string | null = "Bearer s3cret") =>
  POST(
    new Request("http://localhost/api/ingest", {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  );

describe("POST /api/ingest", () => {
  beforeEach(async () => {
    process.env.INGEST_SECRET = "s3cret";
    delete process.env.TELEGRAM_BOT_TOKEN;
    db = await createTestDb();
  });

  it("rejects missing or wrong bearer with 401", async () => {
    expect((await call(body, null)).status).toBe(401);
    expect((await call(body, "Bearer nope")).status).toBe(401);
    expect((await call(body, "s3cret")).status).toBe(401);
    expect(await db.select().from(leads)).toHaveLength(0);
  });

  it("rejects an invalid body with 400", async () => {
    expect((await call("not json")).status).toBe(400);
    expect((await call({ ...body, tgUserId: "abc" })).status).toBe(400);
    expect((await call({ ...body, source: "bot" })).status).toBe(400);
    expect((await call({ ...body, message: undefined })).status).toBe(400);
  });

  it("creates a lead, then reports a duplicate for the same externalId", async () => {
    const first = await call(body);
    expect(first.status).toBe(200);
    const created = await first.json();
    expect(created).toMatchObject({ created: true, duplicate: false });
    expect(typeof created.leadId).toBe("number");

    const again = await (await call(body)).json();
    expect(again).toEqual({ leadId: created.leadId, created: false, duplicate: true });
    expect(await db.select().from(leads)).toHaveLength(1);
  });

  it("a new message from the same user merges into the same lead", async () => {
    const first = await (await call(body)).json();
    const second = await (await call({ ...body, message: { text: "Ещё", externalId: "1:2:4" } })).json();
    expect(second).toEqual({ leadId: first.leadId, created: false, duplicate: false });
  });
});
