import { createHash, timingSafeEqual } from "node:crypto";

/** Сравнение секретов за постоянное время; хеширование выравнивает длины. */
export function secretsEqual(actual: string | null | undefined, expected: string | null | undefined): boolean {
  if (!actual || !expected) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(actual), h(expected));
}
