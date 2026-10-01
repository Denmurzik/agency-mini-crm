import { Api } from "grammy";

/** Клиент Bot API без polling/webhook-обвязки: для исходящих вызовов (уведомления, getWebhookInfo). */
export function getBotApi(): Api | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return token ? new Api(token) : null;
}
