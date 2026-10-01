import { eq } from "drizzle-orm";
import { GrammyError, type Api } from "grammy";
import { getBotApi } from "@/lib/bot/api";
import { getDb, type Db } from "@/lib/db";
import { notifySubscribers } from "@/lib/db/schema";
import type { LeadEvent } from "@/lib/leads/ingest";
import { SOURCE_LABELS } from "@/lib/constants";

const MAX_TEXT = 500;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Текст уведомления (parse_mode HTML): всё пользовательское экранируется. */
export function formatLeadMessage(event: LeadEvent, appUrl?: string): string {
  const { lead } = event;
  const lines = [event.kind === "new" ? "🆕 <b>Новый лид</b>" : "🔁 <b>Повторное обращение</b>", ""];
  lines.push(`<b>Имя:</b> ${escapeHtml(lead.name)}`);
  if (lead.contact) lines.push(`<b>Контакт:</b> ${escapeHtml(lead.contact)}`);
  lines.push(`<b>Источник:</b> ${escapeHtml(SOURCE_LABELS[lead.source])}`);
  if (event.tags.length > 0) lines.push(`<b>Теги:</b> ${event.tags.map(escapeHtml).join(", ")}`);
  if (event.text) {
    const text = event.text.length > MAX_TEXT ? `${event.text.slice(0, MAX_TEXT).trimEnd()}…` : event.text;
    lines.push("", escapeHtml(text));
  }
  const base = appUrl?.replace(/\/+$/, "");
  if (base) lines.push("", `<a href="${base}/?lead=${lead.id}">Открыть карточку</a>`);
  return lines.join("\n");
}

/**
 * Рассылает уведомление всем подписчикам. Нет токена бота — no-op.
 * Подписчик, заблокировавший бота (403), удаляется.
 */
export async function notifyLead(
  event: LeadEvent,
  db: Db = getDb(),
  api: Pick<Api, "sendMessage"> | null = getBotApi(),
): Promise<void> {
  if (!api) return;
  const subscribers = await db.select({ chatId: notifySubscribers.chatId }).from(notifySubscribers);
  if (subscribers.length === 0) return;

  const text = formatLeadMessage(event, process.env.APP_URL);
  await Promise.all(
    subscribers.map(async ({ chatId }) => {
      try {
        await api.sendMessage(chatId, text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
      } catch (err) {
        if (err instanceof GrammyError && err.error_code === 403) {
          await db.delete(notifySubscribers).where(eq(notifySubscribers.chatId, chatId));
        } else {
          console.error(`[notify] failed to send to ${chatId}`, err);
        }
      }
    }),
  );
}
