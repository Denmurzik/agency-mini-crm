import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getNotifySubscribeUrl, verifyNotifyToken } from "./notify-token";

describe("notify-token", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret";
    process.env.TELEGRAM_BOT_USERNAME = "my_agency_bot";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  const tokenFromUrl = () => getNotifySubscribeUrl().split("start=notify_")[1];

  it("builds a deep link with a 32-char hex token", () => {
    const url = getNotifySubscribeUrl();
    expect(url).toMatch(/^https:\/\/t\.me\/my_agency_bot\?start=notify_[0-9a-f]{32}$/);
  });

  it("accepts its own token", () => {
    expect(verifyNotifyToken(tokenFromUrl())).toBe(true);
  });

  it("rejects wrong, empty and wrong-length tokens", () => {
    expect(verifyNotifyToken("0".repeat(32))).toBe(false);
    expect(verifyNotifyToken("")).toBe(false);
    expect(verifyNotifyToken(tokenFromUrl() + "0")).toBe(false);
    expect(verifyNotifyToken("кириллица")).toBe(false);
  });

  it("rejects tokens made with another secret", () => {
    const token = tokenFromUrl();
    process.env.AUTH_SECRET = "other-secret";
    expect(verifyNotifyToken(token)).toBe(false);
  });

  it("rejects everything when the secret is missing", () => {
    const token = tokenFromUrl();
    delete process.env.AUTH_SECRET;
    expect(verifyNotifyToken(token)).toBe(false);
    expect(() => getNotifySubscribeUrl()).toThrow();
  });

  it("strips a leading @ from the bot username", () => {
    process.env.TELEGRAM_BOT_USERNAME = "@my_agency_bot";
    expect(getNotifySubscribeUrl()).toContain("t.me/my_agency_bot?");
  });
});
