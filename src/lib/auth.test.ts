import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkPassword, createSessionToken, safeNextPath, verifySessionToken } from "./auth";

describe("safeNextPath", () => {
  it.each(["/\t/evil.com", "//evil.com", "/\\evil.com", "/\\\\evil.com", "https://evil.com", "javascript:alert(1)", "/\n/evil.com", "/login", "/login?next=/", "", undefined, 42])(
    "не пропускает %j",
    (input) => {
      expect(safeNextPath(input)).toBe("/");
    },
  );

  it.each(["/", "/?lead=5", "/channels?x=1", "/?tag=%D0%A1%D0%B0%D0%B9%D1%82&status=new"])("пропускает %s как есть", (input) => {
    expect(safeNextPath(input)).toBe(input);
  });
});

describe("сессия", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret";
    process.env.CRM_PASSWORD = "pass";
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("принимает свежий токен и отвергает просроченный, подделанный и чужой", async () => {
    const token = await createSessionToken();
    expect(await verifySessionToken(token)).toBe(true);
    expect(await verifySessionToken(token, Date.now() + 31 * 24 * 3600_000)).toBe(false);

    const [exp, sig] = token.split(".");
    expect(await verifySessionToken(`${Number(exp) + 1000}.${sig}`)).toBe(false);
    expect(await verifySessionToken(`${exp}.${sig}.x`)).toBe(false);
    expect(await verifySessionToken("мусор")).toBe(false);
    expect(await verifySessionToken(undefined)).toBe(false);

    process.env.AUTH_SECRET = "other";
    expect(await verifySessionToken(token)).toBe(false);
  });

  it("сверяет пароль и закрывает вход, если он не задан", async () => {
    expect(await checkPassword("pass")).toBe(true);
    expect(await checkPassword("pas")).toBe(false);
    delete process.env.CRM_PASSWORD;
    expect(await checkPassword("")).toBe(false);
  });
});
