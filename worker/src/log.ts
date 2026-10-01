// Логи намеренно скудные: без секретов, сессий и текста сообщений.
export type Logger = {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
};

function write(level: string, msg: string, meta?: Record<string, unknown>) {
  const line = `${new Date().toISOString()} ${level} ${msg}${meta ? " " + JSON.stringify(meta) : ""}`;
  (level === "info" ? console.log : console.error)(line);
}

export const logger: Logger = {
  info: (msg, meta) => write("info", msg, meta),
  warn: (msg, meta) => write("warn", msg, meta),
  error: (msg, meta) => write("error", msg, meta),
};

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

/** Сообщение ошибки для лога: без стека и без возможных пользовательских данных. */
export function errText(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { errorMessage?: unknown; message?: unknown };
    if (typeof e.errorMessage === "string") return e.errorMessage;
    if (typeof e.message === "string") return e.message.slice(0, 200);
  }
  return String(err).slice(0, 200);
}
