/** Ошибка с текстом для пользователя CRM (русский) и HTTP-кодом. */
export class WorkerError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "WorkerError";
  }
}

const REVOKED = new Set([
  "AUTH_KEY_UNREGISTERED",
  "SESSION_REVOKED",
  "SESSION_EXPIRED",
  "USER_DEACTIVATED",
  "USER_DEACTIVATED_BAN",
  "AUTH_KEY_DUPLICATED",
]);

function rpcMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { errorMessage?: unknown; message?: unknown };
    if (typeof e.errorMessage === "string") return e.errorMessage;
    if (typeof e.message === "string") return e.message;
  }
  return "";
}

/** Сессия больше недействительна: аккаунт разлогинили, удалили или забанили. */
export function isRevokedError(err: unknown): boolean {
  const msg = rpcMessage(err);
  return [...REVOKED].some((code) => msg.includes(code));
}

function floodSeconds(err: unknown): number | null {
  if (err && typeof err === "object" && typeof (err as { seconds?: unknown }).seconds === "number") {
    return (err as { seconds: number }).seconds;
  }
  const m = rpcMessage(err).match(/FLOOD_WAIT_(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Переводит ошибки Telegram в понятные пользователю. */
export function mapTelegramError(err: unknown): WorkerError {
  if (err instanceof WorkerError) return err;
  const msg = rpcMessage(err);
  const flood = floodSeconds(err);
  if (flood !== null) return new WorkerError(`Подождите ${flood} сек. и повторите попытку`, 429);
  if (msg.includes("PHONE_CODE_INVALID")) return new WorkerError("Неверный код");
  if (msg.includes("PHONE_CODE_EXPIRED")) return new WorkerError("Код истёк, запросите новый");
  if (msg.includes("PHONE_CODE_EMPTY")) return new WorkerError("Введите код");
  if (msg.includes("PASSWORD_HASH_INVALID")) return new WorkerError("Неверный пароль");
  if (msg.includes("PHONE_NUMBER_INVALID")) return new WorkerError("Неверный номер телефона");
  if (msg.includes("PHONE_NOT_REGISTERED")) return new WorkerError("Этот номер не зарегистрирован в Telegram");
  if (msg.includes("PHONE_NUMBER_BANNED")) return new WorkerError("Этот номер заблокирован в Telegram");
  if (msg.includes("PHONE_NUMBER_FLOOD") || msg.includes("PHONE_PASSWORD_FLOOD")) {
    return new WorkerError("Слишком много попыток входа, повторите позже", 429);
  }
  if (msg.includes("API_ID_INVALID") || msg.includes("API_ID_PUBLISHED_FLOOD")) {
    return new WorkerError("Неверные TG_API_ID / TG_API_HASH на воркере", 500);
  }
  if (isRevokedError(err)) return new WorkerError("Сессия Telegram недействительна, войдите заново", 409);
  return new WorkerError("Ошибка связи с Telegram, попробуйте ещё раз", 502);
}
