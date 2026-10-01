import { beforeEach, describe, expect, it, vi } from "vitest";

const handleUpdate = vi.fn<(update: unknown) => Promise<void>>();
vi.mock("@/lib/bot/bot", () => ({ handleUpdate: (u: unknown) => handleUpdate(u) }));

import { POST } from "./route";

const call = (secret: string | null, body = '{"update_id":1}') =>
  POST(
    new Request("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: secret === null ? {} : { "x-telegram-bot-api-secret-token": secret },
      body,
    }),
  );

describe("POST /api/telegram/webhook", () => {
  beforeEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "hook-secret";
    handleUpdate.mockReset().mockResolvedValue(undefined);
  });

  it("returns 401 without or with a wrong secret header and does not process the update", async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call("wrong")).status).toBe(401);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it("returns 401 when the server secret is not configured", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    expect((await call("")).status).toBe(401);
    expect((await call("anything")).status).toBe(401);
  });

  it("returns 200 and passes the update on with a valid secret", async () => {
    expect((await call("hook-secret")).status).toBe(200);
    expect(handleUpdate).toHaveBeenCalledWith({ update_id: 1 });
  });

  it("returns 400 for a malformed body", async () => {
    expect((await call("hook-secret", "not json")).status).toBe(400);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it("returns 500 when processing fails, so Telegram retries", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    handleUpdate.mockRejectedValue(new Error("db down"));
    expect((await call("hook-secret")).status).toBe(500);
    spy.mockRestore();
  });
});
