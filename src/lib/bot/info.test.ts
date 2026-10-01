import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = { getWebhookInfo: vi.fn(), getMe: vi.fn() };
vi.mock("./api", () => ({ getBotApi: () => (process.env.TELEGRAM_BOT_TOKEN ? api : null) }));

import { getBotInfo } from "./info";

describe("getBotInfo", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = "1:T";
    process.env.TELEGRAM_BOT_USERNAME = "agency_bot";
    api.getWebhookInfo.mockReset();
    api.getMe.mockReset();
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("returns null without a token", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(await getBotInfo()).toBeNull();
  });

  it("maps getWebhookInfo, converting last_error_date from unix seconds to ISO", async () => {
    api.getWebhookInfo.mockResolvedValue({
      url: "https://crm.example.com/api/telegram/webhook",
      pending_update_count: 3,
      last_error_message: "500",
      last_error_date: 1_800_000_000,
    });
    expect(await getBotInfo()).toEqual({
      username: "agency_bot",
      link: "https://t.me/agency_bot",
      webhookUrl: "https://crm.example.com/api/telegram/webhook",
      pendingUpdates: 3,
      lastError: "500",
      lastErrorDate: new Date(1_800_000_000_000).toISOString(),
    });
    expect(api.getMe).not.toHaveBeenCalled();
  });

  it("has null error fields and webhookUrl when nothing is set", async () => {
    api.getWebhookInfo.mockResolvedValue({ url: "", pending_update_count: 0 });
    expect(await getBotInfo()).toMatchObject({ webhookUrl: null, lastError: null, lastErrorDate: null });
  });

  it("falls back to getMe for the username", async () => {
    delete process.env.TELEGRAM_BOT_USERNAME;
    api.getWebhookInfo.mockResolvedValue({ url: "", pending_update_count: 0 });
    api.getMe.mockResolvedValue({ username: "from_get_me" });
    expect(await getBotInfo()).toMatchObject({ username: "from_get_me", link: "https://t.me/from_get_me" });
  });

  it("reports an API failure as lastError instead of throwing", async () => {
    api.getWebhookInfo.mockRejectedValue(new Error("network down"));
    expect(await getBotInfo()).toMatchObject({ lastError: "network down", webhookUrl: null });
  });
});
