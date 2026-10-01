// Клиент HTTP API воркера (Контракт 3). Только для серверного кода: секрет не должен попасть в браузер.

export type WorkerAccount = {
  phone: string;
  tgUserId: number;
  username: string | null;
  displayName: string;
  status: "connected" | "disconnected" | "error";
  lastSeenAt: string | null;
};

export type WorkerStatus = { account: WorkerAccount | null; pending: null | "code" | "password" };
export type SignInResult = { ok: true; account: WorkerAccount } | { needPassword: true };

const TIMEOUT_MS = 15_000;
const UNAVAILABLE = "Воркер недоступен";

/** Ошибка, текст которой можно показать пользователю как есть. */
export class WorkerClientError extends Error {}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const url = process.env.WORKER_URL;
  const secret = process.env.WORKER_SECRET;
  if (!url || !secret) throw new WorkerClientError("Воркер не настроен: задайте WORKER_URL и WORKER_SECRET");

  let res: Response;
  try {
    res = await fetch(new URL(path, url), {
      method,
      headers: { Authorization: `Bearer ${secret}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Сеть, DNS, отказ соединения и таймаут для пользователя выглядят одинаково.
    throw new WorkerClientError(UNAVAILABLE);
  }

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : null;
    // 5xx без понятного текста — это, как правило, упавший прокси перед воркером.
    throw new WorkerClientError(message ?? (res.status >= 500 ? UNAVAILABLE : `Воркер вернул ошибку (HTTP ${res.status})`));
  }
  return data as T;
}

export const workerClient = {
  status: () => call<WorkerStatus>("GET", "/status"),
  sendCode: (phone: string) => call<{ ok: true }>("POST", "/auth/send-code", { phone }),
  signIn: (code: string) => call<SignInResult>("POST", "/auth/sign-in", { code }),
  password: (password: string) => call<{ ok: true; account: WorkerAccount }>("POST", "/auth/password", { password }),
  logout: () => call<{ ok: true }>("POST", "/auth/logout"),
};
