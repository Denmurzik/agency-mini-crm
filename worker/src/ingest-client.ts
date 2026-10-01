import type { Logger } from "./log.js";
import { errText } from "./log.js";
import type { IngestPayload } from "./filter.js";

export type IngestOptions = {
  url: string;
  secret: string;
  fetch?: typeof fetch;
  /** Паузы между попытками, мс. Длина массива + 1 = число попыток. */
  backoffMs?: number[];
  timeoutMs?: number;
  logger: Logger;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Возвращает true при успехе. Ничего не бросает: провал только логируется. */
export async function sendIngest(payload: IngestPayload, opts: IngestOptions): Promise<boolean> {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const backoff = opts.backoffMs ?? [1000, 3000];
  const attempts = backoff.length + 1;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let retryable = true;
    let reason: string;
    try {
      const res = await doFetch(opts.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.secret}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
      if (res.ok) return true;
      reason = `HTTP ${res.status}`;
      // 4xx (кроме 408/429) повтором не лечатся: неверный секрет или тело.
      retryable = res.status >= 500 || res.status === 408 || res.status === 429;
    } catch (err) {
      reason = errText(err);
    }
    if (!retryable || attempt === attempts) {
      opts.logger.error("Не удалось передать лид в CRM", { reason, attempt, externalId: payload.message.externalId });
      return false;
    }
    await sleep(backoff[attempt - 1] ?? 1000);
  }
  return false;
}
