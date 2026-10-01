import { createHmac, timingSafeEqual } from "node:crypto";

/** Токен подписки: первые 32 hex-символа HMAC-SHA256(AUTH_SECRET, "notify"). Посторонний подписаться не сможет. */
function makeToken(secret: string): string {
  return createHmac("sha256", secret).update("notify").digest("hex").slice(0, 32);
}

export function getNotifySubscribeUrl(): string {
  const secret = process.env.AUTH_SECRET;
  const username = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  if (!secret) throw new Error("AUTH_SECRET is not set");
  if (!username) throw new Error("TELEGRAM_BOT_USERNAME is not set");
  return `https://t.me/${username}?start=notify_${makeToken(secret)}`;
}

export function verifyNotifyToken(token: string): boolean {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(makeToken(secret));
  const actual = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
