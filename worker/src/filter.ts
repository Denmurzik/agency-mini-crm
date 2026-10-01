// Чистая логика отбора и преобразования входящих сообщений: без Telegram и сети.

export const TELEGRAM_SERVICE_ID = 777000;
const MAX_TEXT_LENGTH = 4000;

export type MediaKind = "photo" | "voice" | "video" | "videoNote" | "sticker" | "file";

export type SenderInfo = {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  phone?: string | null;
  isBot: boolean;
  isContact: boolean;
};

/** Простые поля, которые вытаскивает адаптер GramJS из события. */
export type IncomingMessage = {
  out: boolean;
  isPrivate: boolean;
  chatId: number;
  messageId: number;
  text: string;
  media: MediaKind | null;
  /** null — отправитель не удалось определить */
  sender: SenderInfo | null;
};

export type IngestPayload = {
  source: "telegram";
  name: string;
  contact: string | null;
  request: string;
  tgUserId: number;
  tgUsername: string | null;
  message: { text: string; externalId: string };
};

export function shouldIngest(m: IncomingMessage, selfId: number): boolean {
  if (m.out || !m.isPrivate) return false;
  const s = m.sender;
  if (!s) return false;
  if (s.isBot) return false;
  if (s.id === selfId || s.id === TELEGRAM_SERVICE_ID) return false;
  // Друзья и знакомые из адресной книги — не лиды.
  if (s.isContact) return false;
  return true;
}

const MEDIA_PLACEHOLDERS: Record<MediaKind, string> = {
  photo: "[фото]",
  voice: "[голосовое сообщение]",
  video: "[видео]",
  videoNote: "[видеосообщение]",
  sticker: "[стикер]",
  file: "[файл]",
};

export function messageText(text: string, media: MediaKind | null): string {
  const trimmed = text.trim();
  // Подпись к медиа остаётся текстом сообщения.
  if (trimmed) return trimmed.slice(0, MAX_TEXT_LENGTH);
  return media ? MEDIA_PLACEHOLDERS[media] : "[сообщение без текста]";
}

export function senderName(s: Pick<SenderInfo, "firstName" | "lastName" | "username">): string {
  const full = [s.firstName, s.lastName].map((p) => p?.trim()).filter(Boolean).join(" ");
  // /api/ingest отвергает имена длиннее 200 символов
  return (full || s.username?.trim() || "Без имени").slice(0, 200);
}

export function senderContact(s: Pick<SenderInfo, "username" | "phone">): string | null {
  const username = s.username?.trim();
  if (username) return `@${username}`;
  const phone = s.phone?.replace(/\D/g, "");
  if (phone) return `+${phone}`;
  return null;
}

export function buildIngestPayload(m: IncomingMessage, selfId: number): IngestPayload {
  const s = m.sender;
  if (!s) throw new Error("Нет данных об отправителе");
  const text = messageText(m.text, m.media);
  return {
    source: "telegram",
    name: senderName(s),
    contact: senderContact(s),
    request: text,
    tgUserId: s.id,
    tgUsername: s.username?.trim() || null,
    message: { text, externalId: `${selfId}:${m.chatId}:${m.messageId}` },
  };
}
