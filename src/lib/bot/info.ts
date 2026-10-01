import { getBotApi } from "./api";

export type BotInfo = {
  username: string;
  link: string;
  webhookUrl: string | null;
  pendingUpdates: number;
  lastError: string | null;
  /** Когда случилась `lastError` (ISO). Telegram не сбрасывает ошибку после восстановления — смотрите на давность. */
  lastErrorDate: string | null;
};

/** Состояние бота для страницы «Каналы». `null` — бот не настроен (нет токена). */
export async function getBotInfo(): Promise<BotInfo | null> {
  const api = getBotApi();
  if (!api) return null;

  let username = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "") ?? "";
  try {
    const [webhook, me] = await Promise.all([api.getWebhookInfo(), username ? null : api.getMe()]);
    if (me) username = me.username ?? "";
    return {
      username,
      link: `https://t.me/${username}`,
      webhookUrl: webhook.url || null,
      pendingUpdates: webhook.pending_update_count,
      lastError: webhook.last_error_message ?? null,
      lastErrorDate: webhook.last_error_date ? new Date(webhook.last_error_date * 1000).toISOString() : null,
    };
  } catch (err) {
    // Telegram недоступен или токен неверный — страница должна показать причину, а не упасть.
    return {
      username,
      link: `https://t.me/${username}`,
      webhookUrl: null,
      pendingUpdates: 0,
      lastError: err instanceof Error ? err.message : String(err),
      lastErrorDate: new Date().toISOString(),
    };
  }
}
