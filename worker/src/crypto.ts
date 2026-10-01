import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";

/** Формат: `iv.tag.ciphertext`, каждая часть в base64. */
export function encryptSession(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

/** Бросает ошибку при неверном ключе, повреждённых данных или неверном формате. */
export function decryptSession(payload: string, key: Buffer): string {
  const parts = payload.split(".");
  if (parts.length !== 3) throw new Error("Неверный формат зашифрованной сессии");
  const [iv, tag, enc] = parts.map((p) => Buffer.from(p, "base64")) as [Buffer, Buffer, Buffer];
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
