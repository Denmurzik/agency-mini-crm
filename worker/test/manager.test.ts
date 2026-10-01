import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decryptSession, encryptSession } from "../src/crypto.js";
import type { IncomingMessage } from "../src/filter.js";
import { silentLogger } from "../src/log.js";
import { AccountManager, normalizePhone } from "../src/manager.js";
import type { AccountRow, AccountStore } from "../src/store.js";
import type { SignInResult, TgClient, TgUser } from "../src/tg.js";

const key = randomBytes(32);
const ME: TgUser = { id: 100, phone: "79991112233", username: "mgr", displayName: "Менеджер" };

const rpc = (errorMessage: string) => Object.assign(new Error(errorMessage), { errorMessage });

class FakeStore implements AccountStore {
  rows: AccountRow[] = [];
  nextId = 1;
  heartbeats = 0;
  async loadActivatable() {
    return [...this.rows].reverse().find((r) => r.sessionEnc && (r.status === "connected" || r.status === "error")) ?? null;
  }
  async getLatest() {
    return this.rows.at(-1) ?? null;
  }
  async replaceAccount(a: Omit<AccountRow, "id" | "lastSeenAt" | "status">) {
    const row: AccountRow = { ...a, id: this.nextId++, status: "connected", lastSeenAt: "now" };
    this.rows = [row];
    return row;
  }
  async heartbeat() {
    this.heartbeats++;
  }
  async setStatus(id: number, status: AccountRow["status"]) {
    const r = this.rows.find((x) => x.id === id);
    if (r) r.status = status;
  }
  async clearSession(id: number) {
    const r = this.rows.find((x) => x.id === id);
    if (r) Object.assign(r, { status: "disconnected", sessionEnc: null });
  }
  async close() {}
}

class FakeClient implements TgClient {
  connected = false;
  session = "SESSION-STRING";
  handler: ((m: IncomingMessage) => void | Promise<void>) | null = null;
  signInResult: SignInResult | Error = { kind: "ok", user: ME };
  passwordResult: TgUser | Error = ME;
  getMeResult: TgUser | Error = ME;
  sendCodeError: Error | null = null;
  loggedOut = false;
  unread: IncomingMessage[] = [];
  fetchUnreadCalls = 0;
  async connect() {
    this.connected = true;
  }
  async disconnect() {
    this.connected = false;
  }
  isConnected() {
    return this.connected;
  }
  async sendCode() {
    if (this.sendCodeError) throw this.sendCodeError;
    return { phoneCodeHash: "hash" };
  }
  async signIn() {
    if (this.signInResult instanceof Error) throw this.signInResult;
    return this.signInResult;
  }
  async checkPassword() {
    if (this.passwordResult instanceof Error) throw this.passwordResult;
    return this.passwordResult;
  }
  async getMe() {
    if (this.getMeResult instanceof Error) throw this.getMeResult;
    return this.getMeResult;
  }
  saveSession() {
    return this.session;
  }
  async logOut() {
    this.loggedOut = true;
  }
  async fetchUnread() {
    this.fetchUnreadCalls++;
    return this.unread;
  }
  listen(h: (m: IncomingMessage) => void | Promise<void>) {
    this.handler = h;
  }
}

function setup(opts: { pendingTtlMs?: number } = {}) {
  const store = new FakeStore();
  const clients: FakeClient[] = [];
  const ingest = vi.fn().mockResolvedValue(true);
  const manager = new AccountManager({
    store,
    createClient: () => {
      const c = new FakeClient();
      clients.push(c);
      return c;
    },
    ingest,
    encKey: key,
    logger: silentLogger,
    heartbeatMs: 1e9,
    ...opts,
  });
  return { store, clients, ingest, manager };
}

const incoming = (over: Partial<IncomingMessage> = {}): IncomingMessage => ({
  out: false,
  isPrivate: true,
  chatId: 555,
  messageId: 7,
  text: "Нужен сайт",
  media: null,
  sender: { id: 555, firstName: "Иван", lastName: null, username: "ivan", phone: null, isBot: false, isContact: false },
  ...over,
});

describe("normalizePhone", () => {
  it("приводит к +цифры", () => {
    expect(normalizePhone("+7 (999) 111-22-33")).toBe("+79991112233");
    expect(normalizePhone("79991112233")).toBe("+79991112233");
  });
  it("отвергает мусор", () => {
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
  });
});

describe("вход в аккаунт", () => {
  it("send-code -> sign-in сохраняет зашифрованную сессию и начинает слушать", async () => {
    const { manager, store, clients } = setup();
    await manager.sendCode("+7 999 111-22-33");
    expect((await manager.status()).pending).toBe("code");

    const res = await manager.signIn("12345");
    expect(res).toMatchObject({ ok: true, account: { phone: "+79991112233", tgUserId: 100, status: "connected" } });

    const row = store.rows[0]!;
    expect(row.sessionEnc).not.toContain("SESSION-STRING");
    expect(decryptSession(row.sessionEnc!, key)).toBe("SESSION-STRING");
    expect(clients[0]!.handler).toBeTypeOf("function");
    expect((await manager.status()).pending).toBeNull();
  });

  it("2FA: sign-in -> needPassword -> password", async () => {
    const { manager, clients } = setup();
    await manager.sendCode("+79991112233");
    clients[0]!.signInResult = { kind: "password" };
    expect(await manager.signIn("12345")).toEqual({ needPassword: true });
    expect((await manager.status()).pending).toBe("password");

    const res = await manager.password("pw");
    expect(res.ok).toBe(true);
    expect((await manager.status()).account?.status).toBe("connected");
  });

  it("неверный код: понятная ошибка, ввод можно повторить", async () => {
    const { manager, clients } = setup();
    await manager.sendCode("+79991112233");
    clients[0]!.signInResult = rpc("PHONE_CODE_INVALID");
    await expect(manager.signIn("00000")).rejects.toThrow("Неверный код");
    expect((await manager.status()).pending).toBe("code");
    clients[0]!.signInResult = { kind: "ok", user: ME };
    expect(await manager.signIn("12345")).toMatchObject({ ok: true });
  });

  it("истёкший код сбрасывает ожидание", async () => {
    const { manager, clients } = setup();
    await manager.sendCode("+79991112233");
    clients[0]!.signInResult = rpc("PHONE_CODE_EXPIRED");
    await expect(manager.signIn("12345")).rejects.toThrow("Код истёк");
    expect((await manager.status()).pending).toBeNull();
  });

  it("неверный пароль 2FA оставляет ожидание пароля", async () => {
    const { manager, clients } = setup();
    await manager.sendCode("+79991112233");
    clients[0]!.signInResult = { kind: "password" };
    await manager.signIn("12345");
    clients[0]!.passwordResult = rpc("PASSWORD_HASH_INVALID");
    await expect(manager.password("bad")).rejects.toThrow("Неверный пароль");
    expect((await manager.status()).pending).toBe("password");
  });

  it("флуд-ожидание при отправке кода", async () => {
    const { manager } = setup();
    // createClient выдаёт нового клиента на каждый вызов; ломаем первого заранее через прототип
    const spy = vi.spyOn(FakeClient.prototype, "sendCode").mockRejectedValueOnce(rpc("FLOOD_WAIT_30"));
    await expect(manager.sendCode("+79991112233")).rejects.toThrow("Подождите 30 сек.");
    spy.mockRestore();
  });

  it("sign-in без send-code — 409", async () => {
    const { manager } = setup();
    await expect(manager.signIn("12345")).rejects.toMatchObject({ status: 409 });
    await expect(manager.password("pw")).rejects.toMatchObject({ status: 409 });
  });

  it("неверный номер отвергается до обращения к Telegram", async () => {
    const { manager, clients } = setup();
    await expect(manager.sendCode("abc")).rejects.toThrow("международном формате");
    expect(clients).toHaveLength(0);
  });

  it("незавершённый вход истекает по таймеру", async () => {
    const { manager, clients } = setup({ pendingTtlMs: 20 });
    await manager.sendCode("+79991112233");
    await new Promise((r) => setTimeout(r, 60));
    expect((await manager.status()).pending).toBeNull();
    expect(clients[0]!.connected).toBe(false);
  });

  it("новый вход заменяет прежний аккаунт и отключает старого клиента", async () => {
    const { manager, clients, store } = setup();
    await manager.sendCode("+79991112233");
    await manager.signIn("11111");
    await manager.sendCode("+79994445566");
    await manager.signIn("22222");
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.phone).toBe("+79994445566");
    expect(clients[0]!.connected).toBe(false);
    expect(clients[1]!.connected).toBe(true);
  });

  it("heartbeat во время замены аккаунта не поднимает старого и не перезаписывает active", async () => {
    const { manager, clients, store } = setup();
    await manager.sendCode("+79991112233");
    await manager.signIn("11111");
    await manager.sendCode("+79994445566");

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const original = store.replaceAccount.bind(store);
    vi.spyOn(store, "replaceAccount").mockImplementation(async (a) => {
      await gate;
      return original(a);
    });

    const signIn = manager.signIn("22222");
    await vi.waitFor(() => expect(clients[0]!.connected).toBe(false)); // старый клиент уже остановлен
    const tick = manager.tick(); // heartbeat ровно в окне между остановкой и записью
    release();
    await signIn;
    await tick;

    expect(clients).toHaveLength(2); // старый аккаунт не поднимали
    expect(clients[1]!.connected).toBe(true);
    await manager.logout();
    expect(clients[1]!.loggedOut).toBe(true); // logout отработал на новом клиенте
    expect(clients[0]!.loggedOut).toBe(false);
  });

  it("logout: отзывает авторизацию в Telegram, строка остаётся без сессии", async () => {
    const { manager, clients, store } = setup();
    await manager.sendCode("+79991112233");
    await manager.signIn("12345");
    await manager.logout();
    expect(clients[0]!.loggedOut).toBe(true);
    expect(store.rows[0]).toMatchObject({ status: "disconnected", sessionEnc: null });
    expect((await manager.status()).account?.status).toBe("disconnected");
  });

  it("если запись нового аккаунта в БД упала, прежний аккаунт поднимется на ближайшем тике", async () => {
    const { manager, clients, store } = setup();
    await manager.sendCode("+79991112233");
    await manager.signIn("11111");
    await manager.sendCode("+79994445566");
    vi.spyOn(store, "replaceAccount").mockRejectedValueOnce(new Error("db down"));
    await expect(manager.signIn("22222")).rejects.toThrow();
    expect(store.rows[0]!.phone).toBe("+79991112233");
    await manager.tick();
    expect(clients).toHaveLength(3);
    expect(clients[2]!.handler).toBeTypeOf("function");
  });
});

describe("живучесть", () => {
  const seed = (store: FakeStore, over: Partial<AccountRow> = {}) => {
    store.rows.push({
      id: store.nextId++,
      phone: "+79991112233",
      tgUserId: 100,
      username: "mgr",
      displayName: "Менеджер",
      sessionEnc: encryptSession("SAVED", key),
      status: "connected",
      lastSeenAt: null,
      ...over,
    });
  };

  it("при старте поднимает сохранённый аккаунт, слушает и пишет heartbeat", async () => {
    const { manager, store, clients } = setup();
    seed(store);
    await manager.start();
    await manager.stop();
    expect(clients).toHaveLength(1);
    expect(clients[0]!.handler).toBeTypeOf("function");
    expect(store.heartbeats).toBe(1);
  });

  it("догонялка при старте: непрочитанные от незнакомых уходят в ingest, контакты нет", async () => {
    const { manager, store, ingest } = setup();
    seed(store);
    const s = incoming().sender!;
    const spy = vi
      .spyOn(FakeClient.prototype, "fetchUnread")
      .mockResolvedValue([
        incoming({ messageId: 1 }),
        incoming({ messageId: 2, sender: { ...s, id: 556, isContact: true } }),
        incoming({ messageId: 3 }),
      ]);
    await manager.start();
    await vi.waitFor(() => expect(ingest).toHaveBeenCalledTimes(2));
    expect(ingest.mock.calls.map((c) => c[0].message.externalId)).toEqual(["100:555:1", "100:555:3"]);
    await manager.stop();
    spy.mockRestore();
  });

  it("догонялка после восстановления связи", async () => {
    const { manager, store, clients } = setup();
    seed(store);
    await manager.start();
    await vi.waitFor(() => expect(clients[0]!.fetchUnreadCalls).toBe(1));
    clients[0]!.getMeResult = new Error("timeout");
    await manager.tick();
    clients[0]!.getMeResult = ME;
    await manager.tick();
    await vi.waitFor(() => expect(clients[0]!.fetchUnreadCalls).toBe(2));
    await manager.stop();
  });

  it("сбой догонялки не мешает работе", async () => {
    const { manager, store } = setup();
    seed(store);
    const spy = vi.spyOn(FakeClient.prototype, "fetchUnread").mockRejectedValue(new Error("boom"));
    await manager.start();
    await manager.tick();
    await manager.stop();
    spy.mockRestore();
    expect(store.heartbeats).toBe(2);
  });

  it("сбой инициализации после getMe не оставляет active: следующий тик повторяет активацию", async () => {
    const { manager, store, clients } = setup();
    seed(store, { status: "error" });
    vi.spyOn(store, "setStatus").mockRejectedValueOnce(new Error("db down"));
    await manager.start();
    expect(clients[0]!.handler).toBeNull(); // слушатель не повешен
    expect(clients[0]!.connected).toBe(false);

    await manager.tick();
    expect(clients).toHaveLength(2);
    expect(clients[1]!.handler).toBeTypeOf("function");
    expect(store.rows[0]!.status).toBe("connected");
    await manager.stop();
  });

  it("на тике обновляет last_seen_at", async () => {
    const { manager, store } = setup();
    seed(store);
    await manager.start();
    await manager.tick();
    await manager.stop();
    expect(store.heartbeats).toBe(2);
  });

  it("отозванная сессия при старте: disconnected и session_enc = null", async () => {
    const { manager, store, clients } = setup();
    seed(store);
    // клиент создаётся внутри start, поэтому подменяем getMe у прототипа
    const spy = vi.spyOn(FakeClient.prototype, "getMe").mockRejectedValue(rpc("AUTH_KEY_UNREGISTERED"));
    await manager.start();
    await manager.stop();
    spy.mockRestore();
    expect(store.rows[0]).toMatchObject({ status: "disconnected", sessionEnc: null });
    expect(clients[0]!.handler).toBeNull();
  });

  it("отзыв во время работы (heartbeat) отключает аккаунт и прекращает слушать", async () => {
    const { manager, store, clients } = setup();
    seed(store);
    await manager.start();
    clients[0]!.getMeResult = rpc("SESSION_REVOKED");
    await manager.tick();
    expect(store.rows[0]).toMatchObject({ status: "disconnected", sessionEnc: null });
    expect(clients[0]!.connected).toBe(false);
    await manager.stop();
  });

  it("потеря связи: после 3 неудачных heartbeat статус error, после восстановления connected", async () => {
    const { manager, store, clients } = setup();
    seed(store);
    await manager.start();
    clients[0]!.getMeResult = new Error("timeout");
    for (let i = 0; i < 3; i++) await manager.tick();
    expect(store.rows[0]!.status).toBe("error");
    clients[0]!.getMeResult = ME;
    await manager.tick();
    expect(store.rows[0]!.status).toBe("connected");
    await manager.stop();
  });

  it("не удалось расшифровать сессию (чужой ключ): status error, повторов нет", async () => {
    const { manager, store, clients } = setup();
    seed(store, { sessionEnc: encryptSession("SAVED", randomBytes(32)) });
    await manager.start();
    await manager.tick();
    await manager.stop();
    expect(store.rows[0]!.status).toBe("error");
    expect(clients).toHaveLength(0);
  });

  it("аккаунт disconnected без сессии не поднимается", async () => {
    const { manager, store, clients } = setup();
    seed(store, { status: "disconnected", sessionEnc: null });
    await manager.start();
    await manager.stop();
    expect(clients).toHaveLength(0);
  });
});

describe("входящие сообщения", () => {
  it("лид отправляется в ingest, externalId содержит id аккаунта", async () => {
    const { manager, ingest } = setup();
    manager.onMessage(incoming(), 100);
    await Promise.resolve();
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest.mock.calls[0]![0]).toMatchObject({
      source: "telegram",
      tgUserId: 555,
      message: { externalId: "100:555:7" },
    });
  });

  it("контакты, боты, исходящие и группы не доходят до ingest", async () => {
    const { manager, ingest } = setup();
    const s = incoming().sender!;
    manager.onMessage(incoming({ sender: { ...s, isContact: true } }), 100);
    manager.onMessage(incoming({ sender: { ...s, isBot: true } }), 100);
    manager.onMessage(incoming({ out: true }), 100);
    manager.onMessage(incoming({ isPrivate: false }), 100);
    await Promise.resolve();
    expect(ingest).not.toHaveBeenCalled();
  });
});
