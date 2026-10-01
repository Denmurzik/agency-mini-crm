import { desc, eq, sql } from "drizzle-orm";
import { GrammyError } from "grammy";
import type { BusinessConnection, Message } from "grammy/types";
import type { Db } from "@/lib/db";
import { tgBusinessConnections } from "@/lib/db/schema";
import { ingestLead, type IngestOptions } from "@/lib/leads/ingest";

/**
 * Telegram Business: бот, привязанный к аккаунту владельца, получает его личные переписки
 * (`business_message`). ВАЖНО: в этих чатах бот никогда ничего не отправляет — ответ ушёл бы от имени владельца.
 * Поэтому здесь нет вызовов `send*`, а апдейты не попадают в автомат диалога и `bot_sessions`.
 *
 * Фильтра «не из контактов» на стороне Bot API нет: его задаёт сам владелец в настройках Telegram
 * («Telegram для бизнеса → Чат-боты → Доступ к чатам → все, кроме контактов»).
 */

const MAX_TEXT_LENGTH = 4000;

type BusinessApi = { getBusinessConnection(id: string): Promise<BusinessConnection> };

const fullName = (u: { first_name?: string; last_name?: string }) =>
  [u.first_name, u.last_name].filter(Boolean).join(" ").trim();

/** Текст сообщения или плейсхолдер вида «[фото]» (подпись к медиа остаётся текстом). */
export function businessMessageText(msg: Message): string {
  const text = (msg.text ?? msg.caption ?? "").trim();
  if (text) return text.slice(0, MAX_TEXT_LENGTH);
  if (msg.photo) return "[фото]";
  if (msg.voice) return "[голосовое сообщение]";
  if (msg.video || msg.animation) return "[видео]";
  if (msg.video_note) return "[видеосообщение]";
  if (msg.sticker) return "[стикер]";
  if (msg.document || msg.audio) return "[файл]";
  return "[сообщение без текста]";
}

/** Создаёт или обновляет подключение (в том числе отключение: `is_enabled: false`). */
export async function saveBusinessConnection(db: Db, conn: BusinessConnection): Promise<void> {
  const values = {
    ownerTgUserId: conn.user.id,
    ownerUsername: conn.user.username ?? null,
    ownerName: fullName(conn.user) || null,
    isEnabled: conn.is_enabled,
  };
  await db
    .insert(tgBusinessConnections)
    .values({ id: conn.id, ...values })
    .onConflictDoUpdate({ target: tgBusinessConnections.id, set: { ...values, updatedAt: sql`now()` } });
}

/**
 * Входящее сообщение из бизнес-чата → лид. Исходящие владельца, боты и не-личные чаты пропускаются.
 * Ошибка записи пробрасывается (webhook ответит 500, Telegram повторит; повтор дедуплицируется по externalId).
 */
export async function ingestBusinessMessage(
  db: Db,
  msg: Message,
  api: BusinessApi,
  ingestOptions?: IngestOptions,
): Promise<void> {
  const connId = msg.business_connection_id;
  const from = msg.from;
  if (!connId || !from || from.is_bot || msg.chat.type !== "private") return;

  let [conn] = await db.select().from(tgBusinessConnections).where(eq(tgBusinessConnections.id, connId)).limit(1);
  if (!conn) {
    // Апдейт business_connection мог прийти раньше, чем мы разрешили его в allowed_updates.
    try {
      await saveBusinessConnection(db, await api.getBusinessConnection(connId));
    } catch (err) {
      // Подключение удалено/недоступно — повтор не поможет, не блокируем очередь апдейтов.
      if (err instanceof GrammyError && (err.error_code === 400 || err.error_code === 403)) {
        console.warn("[business] unknown connection, message skipped", connId, err.description);
        return;
      }
      throw err;
    }
    [conn] = await db.select().from(tgBusinessConnections).where(eq(tgBusinessConnections.id, connId)).limit(1);
    if (!conn) return;
  }

  // Исходящее: писал сам владелец (или он — не собеседник этого чата).
  if (from.id === conn.ownerTgUserId || from.id !== msg.chat.id) return;

  const text = businessMessageText(msg);
  const username = from.username ?? null;
  await ingestLead(
    db,
    {
      source: "telegram",
      name: fullName(from) || (username ? `@${username}` : "Без имени"),
      contact: username ? `@${username}` : null,
      request: text,
      tgUserId: from.id,
      tgUsername: username,
      message: { text, externalId: `biz:${connId}:${msg.chat.id}:${msg.message_id}` },
    },
    ingestOptions,
  );
  await db
    .update(tgBusinessConnections)
    .set({ lastMessageAt: sql`now()` })
    .where(eq(tgBusinessConnections.id, connId));
}

export type BusinessStatus = {
  connected: boolean;
  ownerName: string | null;
  ownerUsername: string | null;
  lastMessageAt: Date | null;
};

/** Состояние подключения для страницы «Каналы». `null` — подключений нет. */
export async function getBusinessStatus(db: Db): Promise<BusinessStatus | null> {
  const [row] = await db
    .select()
    .from(tgBusinessConnections)
    .orderBy(desc(tgBusinessConnections.isEnabled), desc(tgBusinessConnections.updatedAt))
    .limit(1);
  if (!row) return null;
  return {
    connected: row.isEnabled,
    ownerName: row.ownerName,
    ownerUsername: row.ownerUsername,
    lastMessageAt: row.lastMessageAt,
  };
}
