import { decryptSession, encryptSession } from "./crypto.js";
import { WorkerError, isRevokedError, mapTelegramError } from "./errors.js";
import { buildIngestPayload, shouldIngest, type IncomingMessage, type IngestPayload } from "./filter.js";
import { errText, type Logger } from "./log.js";
import type { AccountRow, AccountStore } from "./store.js";
import type { TgClient, TgClientFactory, TgUser } from "./tg.js";
import type { AccountInfo, PendingStage, SignInResponse, StatusResponse, WorkerService } from "./types.js";

export type ManagerDeps = {
  store: AccountStore;
  createClient: TgClientFactory;
  ingest: (payload: IngestPayload) => Promise<boolean>;
  encKey: Buffer;
  logger: Logger;
  heartbeatMs?: number;
  pendingTtlMs?: number;
};

type Pending = {
  client: TgClient;
  phone: string;
  phoneCodeHash: string;
  stage: "code" | "password";
  timer: NodeJS.Timeout;
};

type Active = { id: number; selfId: number; client: TgClient; failures: number; degraded: boolean };

/** После стольких неудачных heartbeat подряд (по 30 с) статус аккаунта становится 'error'. */
const FAILURES_BEFORE_ERROR = 3;

const PING_TIMEOUT_MS = 15_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Таймаут запроса к Telegram")), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Телефон в международном формате: `+` и 7-15 цифр. Возвращает null, если не похоже на номер. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, "");
  return /^\+?\d{7,15}$/.test(digits) ? (digits.startsWith("+") ? digits : `+${digits}`) : null;
}

function toInfo(row: AccountRow): AccountInfo {
  const { id: _id, sessionEnc: _session, ...info } = row;
  return info;
}

export class AccountManager implements WorkerService {
  private active: Active | null = null;
  private pending: Pending | null = null;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private stopped = false;
  // Строка, сессию которой не удалось расшифровать: не долбим базу и лог каждые 30 с.
  private undecryptableId: number | null = null;
  private authQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: ManagerDeps) {}

  // ---- жизненный цикл ----

  async start(): Promise<void> {
    await this.tick();
    this.timer = setInterval(() => void this.tick(), this.deps.heartbeatMs ?? 30_000);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.dropPending();
    const active = this.active;
    this.active = null;
    await active?.client.disconnect().catch(() => undefined);
  }

  /** Один шаг heartbeat: поднять аккаунт, если не поднят, иначе проверить связь и отметить last_seen_at. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      if (this.active) await this.ping(this.active);
      else {
        // Активация идёт в той же очереди, что и вход: иначе heartbeat между остановкой старого
        // клиента и записью нового аккаунта поднял бы старый и перезаписал active.
        await this.serial(async () => {
          if (this.active || this.stopped) return;
          const row = await this.deps.store.loadActivatable();
          if (row && row.id !== this.undecryptableId) await this.activateFromRow(row);
        });
      }
    } catch (err) {
      this.deps.logger.error("Сбой heartbeat", { reason: errText(err) });
    } finally {
      this.ticking = false;
    }
  }

  private async ping(a: Active): Promise<void> {
    const { store, logger } = this.deps;
    try {
      // GramJS при обрыве может не бросить ошибку, а подвесить запрос: ограничиваем ожидание.
      await withTimeout(a.client.getMe(), PING_TIMEOUT_MS);
    } catch (err) {
      // Пока шёл запрос, аккаунт могли заменить или отключить: чужого клиента не трогаем.
      if (this.active !== a) return;
      if (isRevokedError(err)) return this.handleRevoked(a);
      a.failures++;
      logger.warn("Нет связи с Telegram", { failures: a.failures, reason: errText(err) });
      if (!a.degraded && a.failures >= FAILURES_BEFORE_ERROR) {
        a.degraded = true;
        await store.setStatus(a.id, "error");
      }
      if (!a.client.isConnected()) await a.client.connect().catch(() => undefined);
      return;
    }
    if (this.active !== a) return;
    const hadFailures = a.failures > 0;
    a.failures = 0;
    if (a.degraded) {
      a.degraded = false;
      await store.setStatus(a.id, "connected");
    }
    await store.heartbeat(a.id);
    if (hadFailures) {
      logger.info("Связь с Telegram восстановлена");
      void this.catchUp(a);
    }
  }

  private async handleRevoked(a: Active): Promise<void> {
    this.deps.logger.warn("Сессия Telegram отозвана, аккаунт отключён");
    if (this.active === a) this.active = null;
    await a.client.disconnect().catch(() => undefined);
    await this.deps.store.clearSession(a.id);
  }

  private async activateFromRow(row: AccountRow): Promise<void> {
    const { store, logger, createClient } = this.deps;
    let session: string;
    try {
      session = decryptSession(row.sessionEnc!, this.deps.encKey);
    } catch {
      this.undecryptableId = row.id;
      logger.error("Не удалось расшифровать сессию: проверьте SESSION_ENC_KEY");
      await store.setStatus(row.id, "error");
      return;
    }
    const client = createClient(session);
    try {
      await client.connect();
      const me = await client.getMe();
      if (row.status !== "connected") await store.setStatus(row.id, "connected");
      await store.heartbeat(row.id);
      // Публикуем active только после полной инициализации: при сбое выше ничего не остаётся
      // в памяти, и следующий тик повторит активацию.
      const active = this.activate(row.id, me.id, client);
      logger.info("Аккаунт подключён, слушаю личные сообщения");
      void this.catchUp(active);
    } catch (err) {
      await client.disconnect().catch(() => undefined);
      if (isRevokedError(err)) {
        logger.warn("Сессия Telegram отозвана, аккаунт отключён");
        await store.clearSession(row.id);
      } else {
        logger.error("Не удалось подключить аккаунт", { reason: errText(err) });
        if (row.status !== "error") await store.setStatus(row.id, "error");
      }
    }
  }

  private activate(id: number, selfId: number, client: TgClient): Active {
    const active: Active = { id, selfId, client, failures: 0, degraded: false };
    this.active = active;
    client.listen((msg) => this.onMessage(msg, selfId));
    return active;
  }

  // ---- входящие ----

  /** Не ждём доставку в CRM: ретраи с паузами не должны задерживать обработку следующих сообщений. */
  onMessage(msg: IncomingMessage, selfId: number): void {
    void this.deliver(msg, selfId);
  }

  private async deliver(msg: IncomingMessage, selfId: number): Promise<void> {
    if (!shouldIngest(msg, selfId)) return;
    let payload: IngestPayload;
    try {
      payload = buildIngestPayload(msg, selfId);
    } catch (err) {
      this.deps.logger.error("Не удалось собрать лид", { reason: errText(err) });
      return;
    }
    if (await this.deps.ingest(payload)) {
      this.deps.logger.info("Лид из Telegram передан в CRM", { externalId: payload.message.externalId });
    }
  }

  /**
   * Догоняет сообщения, пришедшие, пока воркер был недоступен (деплой, обрыв).
   * Дубли безопасны: /api/ingest идемпотентен по externalId.
   */
  async catchUp(a: Active): Promise<void> {
    try {
      const msgs = await a.client.fetchUnread({ dialogs: 30, perDialog: 20, maxAgeMs: 48 * 3600_000 });
      for (const m of msgs) {
        if (this.active !== a) return;
        await this.deliver(m, a.selfId);
      }
      if (msgs.length) this.deps.logger.info("Догонялка: обработаны непрочитанные", { count: msgs.length });
    } catch (err) {
      this.deps.logger.warn("Догонялка не удалась", { reason: errText(err) });
    }
  }

  // ---- вход в аккаунт (WorkerService) ----

  async status(): Promise<StatusResponse> {
    const row = await this.deps.store.getLatest();
    return { account: row ? toInfo(row) : null, pending: this.pendingStage() };
  }

  private pendingStage(): PendingStage {
    return this.pending ? this.pending.stage : null;
  }

  /** Операции входа выполняются строго по очереди: два параллельных sign-in дали бы гонку. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.authQueue.then(fn, fn);
    this.authQueue = run.catch(() => undefined);
    return run;
  }

  sendCode(rawPhone: string): Promise<void> {
    return this.serial(async () => {
      const phone = normalizePhone(rawPhone);
      if (!phone) throw new WorkerError("Введите номер в международном формате, например +79991234567");
      this.dropPending();
      const client = this.deps.createClient("");
      try {
        await client.connect();
        const { phoneCodeHash } = await client.sendCode(phone);
        const timer = setTimeout(() => this.dropPending(), this.deps.pendingTtlMs ?? 10 * 60_000);
        timer.unref();
        this.pending = { client, phone, phoneCodeHash, stage: "code", timer };
      } catch (err) {
        await client.disconnect().catch(() => undefined);
        this.deps.logger.warn("Не удалось отправить код", { reason: errText(err) });
        throw mapTelegramError(err);
      }
    });
  }

  signIn(code: string): Promise<SignInResponse> {
    return this.serial(async () => {
      const p = this.requirePending("code", "Сначала запросите код");
      try {
        const res = await p.client.signIn(p.phone, p.phoneCodeHash, code);
        if (res.kind === "password") {
          p.stage = "password";
          return { needPassword: true as const };
        }
        return { ok: true as const, account: await this.finish(p, res.user) };
      } catch (err) {
        // Истёкший код не оживить: нужен новый send-code.
        if (/PHONE_CODE_EXPIRED/.test(errText(err))) this.dropPending();
        if (!(err instanceof WorkerError)) this.deps.logger.warn("Вход по коду не удался", { reason: errText(err) });
        throw mapTelegramError(err);
      }
    });
  }

  password(password: string): Promise<{ ok: true; account: AccountInfo }> {
    return this.serial(async () => {
      const p = this.requirePending("password", "Сначала введите код из Telegram");
      try {
        const user = await p.client.checkPassword(password);
        return { ok: true as const, account: await this.finish(p, user) };
      } catch (err) {
        if (!(err instanceof WorkerError)) this.deps.logger.warn("Вход по паролю не удался", { reason: errText(err) });
        throw mapTelegramError(err);
      }
    });
  }

  logout(): Promise<void> {
    return this.serial(async () => {
      this.dropPending();
      const a = this.active;
      this.active = null;
      if (a) {
        // Если выход на стороне Telegram не удался, сессию всё равно удаляем у себя.
        await a.client.logOut().catch(() => undefined);
        await a.client.disconnect().catch(() => undefined);
      }
      // Строка остаётся как «отключён» (UI покажет последний номер), но без сессии.
      if (a) await this.deps.store.clearSession(a.id);
      else {
        const row = await this.deps.store.getLatest();
        if (row) await this.deps.store.clearSession(row.id);
      }
    });
  }

  private requirePending(stage: "code" | "password", message: string): Pending {
    if (!this.pending || this.pending.stage !== stage) throw new WorkerError(message, 409);
    return this.pending;
  }

  private dropPending(): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    void p.client.disconnect().catch(() => undefined);
  }

  private async finish(p: Pending, user: TgUser): Promise<AccountInfo> {
    const sessionEnc = encryptSession(p.client.saveSession(), this.deps.encKey);
    // Сначала останавливаем прежний клиент: один слот. Если запись в БД не удастся, старая строка
    // останется, и ближайший heartbeat поднимет прежний аккаунт заново.
    const old = this.active;
    this.active = null;
    await old?.client.disconnect().catch(() => undefined);
    const row = await this.deps.store.replaceAccount({
      phone: p.phone,
      tgUserId: user.id,
      username: user.username,
      displayName: user.displayName,
      sessionEnc,
    });
    clearTimeout(p.timer);
    this.pending = null;
    this.undecryptableId = null;
    this.activate(row.id, user.id, p.client);
    this.deps.logger.info("Аккаунт Telegram подключён через вход");
    return toInfo(row);
  }
}
