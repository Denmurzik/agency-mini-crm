const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const shortDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
const shortDateYear = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" });
const dateTime = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const shortDateTime = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** «5 мин назад», «вчера», «12 окт» — для колонки «Активность». */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  if (diff < MINUTE) return "только что";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} мин назад`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} ч назад`;
  if (diff < 2 * DAY) return "вчера";
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} дн назад`;
  const date = new Date(iso);
  return (date.getFullYear() === new Date(now).getFullYear() ? shortDate : shortDateYear).format(date);
}

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function formatShortDateTime(iso: string): string {
  return shortDateTime.format(new Date(iso));
}

/** Телефон без середины: «+7 ••• ••• 12 34». Ничего не угадываем, если формат нестандартный. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return phone;
  const tail = digits.slice(-4);
  return `+${digits.slice(0, digits.length > 10 ? digits.length - 10 : 1)} ••• ••• ${tail.slice(0, 2)} ${tail.slice(2)}`;
}

/** Ссылка «Открыть в Telegram»: по username, иначе по id пользователя. */
export function telegramLink(lead: { tgUsername: string | null; tgUserId: number | null }): string | null {
  if (lead.tgUsername) return `https://t.me/${lead.tgUsername.replace(/^@/, "")}`;
  if (lead.tgUserId) return `tg://user?id=${lead.tgUserId}`;
  return null;
}
