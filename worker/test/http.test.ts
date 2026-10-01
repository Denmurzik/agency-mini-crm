import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerError } from "../src/errors.js";
import { createHttpServer, isAuthorized } from "../src/http.js";
import { silentLogger } from "../src/log.js";
import type { AccountInfo, WorkerService } from "../src/types.js";

const SECRET = "worker-secret";
const account: AccountInfo = {
  phone: "+79991112233",
  tgUserId: 1,
  username: "mgr",
  displayName: "Менеджер",
  status: "connected",
  lastSeenAt: null,
};

let service: { [K in keyof WorkerService]: ReturnType<typeof vi.fn> };
let server: Server;
let base: string;

beforeEach(async () => {
  service = {
    status: vi.fn().mockResolvedValue({ account: null, pending: null }),
    sendCode: vi.fn().mockResolvedValue(undefined),
    signIn: vi.fn().mockResolvedValue({ ok: true, account }),
    password: vi.fn().mockResolvedValue({ ok: true, account }),
    logout: vi.fn().mockResolvedValue(undefined),
  };
  server = createHttpServer({ service: service as unknown as WorkerService, secret: SECRET, logger: silentLogger });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => new Promise<void>((r) => server.close(() => r())));

const call = (path: string, init: RequestInit & { token?: string | null } = {}) => {
  const { token = SECRET, ...rest } = init;
  return fetch(base + path, {
    ...rest,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
};

describe("isAuthorized", () => {
  it("принимает только точный Bearer-секрет", () => {
    expect(isAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorized(SECRET, SECRET)).toBe(false);
    expect(isAuthorized(undefined, SECRET)).toBe(false);
  });
});

describe("авторизация HTTP API", () => {
  it("401 без заголовка Authorization", async () => {
    const res = await call("/status", { token: null });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Не авторизован" });
    expect(service.status).not.toHaveBeenCalled();
  });

  it("401 с неверным секретом на всех маршрутах", async () => {
    for (const [method, path] of [
      ["GET", "/status"],
      ["POST", "/auth/send-code"],
      ["POST", "/auth/sign-in"],
      ["POST", "/auth/password"],
      ["POST", "/auth/logout"],
    ] as const) {
      const res = await call(path, { method, token: "wrong", body: method === "POST" ? "{}" : undefined });
      expect(res.status, path).toBe(401);
    }
    expect(service.logout).not.toHaveBeenCalled();
    expect(service.sendCode).not.toHaveBeenCalled();
  });

  it("GET /health доступен без авторизации", async () => {
    const res = await call("/health", { token: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("маршруты", () => {
  it("GET /status", async () => {
    const res = await call("/status");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ account: null, pending: null });
  });

  it("POST /auth/send-code передаёт телефон", async () => {
    const res = await call("/auth/send-code", { method: "POST", body: JSON.stringify({ phone: "+7 999 111-22-33" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(service.sendCode).toHaveBeenCalledWith("+7 999 111-22-33");
  });

  it("POST /auth/sign-in нормализует код (пробелы и дефисы)", async () => {
    const res = await call("/auth/sign-in", { method: "POST", body: JSON.stringify({ code: "12-345" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, account });
    expect(service.signIn).toHaveBeenCalledWith("12345");
  });

  it("POST /auth/sign-in возвращает needPassword", async () => {
    service.signIn.mockResolvedValue({ needPassword: true });
    const res = await call("/auth/sign-in", { method: "POST", body: JSON.stringify({ code: "12345" }) });
    expect(await res.json()).toEqual({ needPassword: true });
  });

  it("POST /auth/password и /auth/logout", async () => {
    const p = await call("/auth/password", { method: "POST", body: JSON.stringify({ password: "pw" }) });
    expect(await p.json()).toEqual({ ok: true, account });
    expect(service.password).toHaveBeenCalledWith("pw");
    const l = await call("/auth/logout", { method: "POST" });
    expect(await l.json()).toEqual({ ok: true });
  });

  it("400 с русским текстом на невалидное тело", async () => {
    const res = await call("/auth/sign-in", { method: "POST", body: JSON.stringify({ code: "abc" }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Код состоит из 4-8 цифр");
    const res2 = await call("/auth/send-code", { method: "POST", body: "{не json" });
    expect(res2.status).toBe(400);
  });

  it("ошибка сервиса уходит как { error } с её кодом", async () => {
    service.signIn.mockRejectedValue(new WorkerError("Неверный код", 400));
    const res = await call("/auth/sign-in", { method: "POST", body: JSON.stringify({ code: "12345" }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Неверный код" });
  });

  it("непредвиденная ошибка — 500 без деталей", async () => {
    service.status.mockRejectedValue(new Error("db password leaked"));
    const res = await call("/status");
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("leaked");
  });

  it("404 и 405", async () => {
    expect((await call("/nope")).status).toBe(404);
    expect((await call("/status", { method: "POST", body: "{}" })).status).toBe(405);
  });
});
