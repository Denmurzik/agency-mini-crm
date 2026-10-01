import { cookies } from "next/headers";

export const SESSION_COOKIE = "crm_session";
export const SESSION_TTL_SEC = 60 * 60 * 24 * 30;

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}

/** Сравнение за постоянное время: сначала хэшируем, чтобы длина не влияла на результат. */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([crypto.subtle.digest("SHA-256", encoder.encode(a)), crypto.subtle.digest("SHA-256", encoder.encode(b))]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function checkPassword(input: string): Promise<boolean> {
  const expected = process.env.CRM_PASSWORD;
  // Пустой пароль в окружении = вход закрыт, а не открыт для всех.
  if (!expected) return false;
  return safeEqual(input, expected);
}

/** Токен сессии: `<exp>.<HMAC-SHA256(AUTH_SECRET, exp)>`, exp — unix-время в секундах. */
export async function createSessionToken(now = Date.now()): Promise<string> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  const exp = String(Math.floor(now / 1000) + SESSION_TTL_SEC);
  return `${exp}.${await hmacHex(secret, exp)}`;
}

export async function verifySessionToken(token: string | undefined | null, now = Date.now()): Promise<boolean> {
  const secret = process.env.AUTH_SECRET;
  if (!token || !secret) return false;
  const [exp, sig, ...rest] = token.split(".");
  if (!exp || !sig || rest.length > 0 || !/^\d+$/.test(exp)) return false;
  if (Number(exp) * 1000 <= now) return false;
  return safeEqual(sig, await hmacHex(secret, exp));
}

/** Для server components и server actions: прокси защищает маршруты, но каждый action проверяет сессию сам. */
export async function isAuthenticated(): Promise<boolean> {
  return verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function requireSession(): Promise<void> {
  if (!(await isAuthenticated())) throw new Error("Требуется вход");
}

export async function setSessionCookie(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * Куда вернуть после входа: только пути своего сайта, иначе это open redirect.
 * Разбираем тем же парсером, что и браузер: он вырезает табы и переводы строк, поэтому «/», таб, «/evil.com»
 * для него — `//evil.com`, и проверка по префиксу строки такое пропустит.
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string") return "/";
  try {
    const url = new URL(next, "http://x");
    if (url.origin !== "http://x" || url.pathname.startsWith("/login")) return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}
