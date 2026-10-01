import { describe, expect, it } from "vitest";
import { isRevokedError, mapTelegramError } from "../src/errors.js";

const rpc = (errorMessage: string, extra: object = {}) =>
  Object.assign(new Error(errorMessage), { errorMessage, ...extra });

describe("mapTelegramError", () => {
  it.each([
    ["PHONE_CODE_INVALID", "Неверный код"],
    ["PHONE_CODE_EXPIRED", "Код истёк, запросите новый"],
    ["PASSWORD_HASH_INVALID", "Неверный пароль"],
    ["PHONE_NUMBER_INVALID", "Неверный номер телефона"],
  ])("%s даёт понятный текст", (code, text) => {
    expect(mapTelegramError(rpc(code)).message).toBe(text);
  });

  it("флуд-ожидание с числом секунд из поля seconds", () => {
    const e = mapTelegramError(rpc("A wait of 42 seconds is required", { seconds: 42 }));
    expect(e.message).toBe("Подождите 42 сек. и повторите попытку");
    expect(e.status).toBe(429);
  });

  it("флуд-ожидание из текста FLOOD_WAIT_N", () => {
    expect(mapTelegramError(rpc("FLOOD_WAIT_17")).message).toContain("17");
  });

  it("неизвестная ошибка не раскрывает подробности", () => {
    const e = mapTelegramError(new Error("socket hang up secret-detail"));
    expect(e.message).toBe("Ошибка связи с Telegram, попробуйте ещё раз");
    expect(e.status).toBe(502);
  });
});

describe("isRevokedError", () => {
  it.each(["AUTH_KEY_UNREGISTERED", "SESSION_REVOKED", "USER_DEACTIVATED"])("%s", (code) => {
    expect(isRevokedError(rpc(code))).toBe(true);
  });
  it("обычная ошибка не считается отзывом", () => expect(isRevokedError(new Error("timeout"))).toBe(false));
});
