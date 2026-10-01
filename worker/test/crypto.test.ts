import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSession, encryptSession } from "../src/crypto.js";

describe("шифрование сессии", () => {
  const key = randomBytes(32);

  it("расшифровывает то, что зашифровал", () => {
    const session = "1BQANOTEuMTA4LjU2LjE2NwG7";
    const enc = encryptSession(session, key);
    expect(enc.split(".")).toHaveLength(3);
    expect(enc).not.toContain(session);
    expect(decryptSession(enc, key)).toBe(session);
  });

  it("каждый раз использует новый iv", () => {
    expect(encryptSession("x", key)).not.toBe(encryptSession("x", key));
  });

  it("не расшифровывается чужим ключом", () => {
    expect(() => decryptSession(encryptSession("secret", key), randomBytes(32))).toThrow();
  });

  it("обнаруживает подмену шифртекста", () => {
    const [iv, tag, ct] = encryptSession("secret", key).split(".") as [string, string, string];
    const tampered = Buffer.from(ct, "base64");
    tampered[0] = tampered[0]! ^ 1;
    expect(() => decryptSession(`${iv}.${tag}.${tampered.toString("base64")}`, key)).toThrow();
  });

  it("отвергает неверный формат", () => {
    expect(() => decryptSession("мусор", key)).toThrow();
  });
});
