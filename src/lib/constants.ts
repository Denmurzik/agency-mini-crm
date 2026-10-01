import type { LeadSource, LeadStatus } from "@/lib/db/schema";

export const SOURCE_LABELS: Record<LeadSource, string> = {
  bot: "Бот",
  telegram: "Telegram",
  manual: "Вручную",
};

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "Новый",
  in_progress: "В работе",
  won: "Сделка",
  lost: "Отказ",
};

/** Услуги агентства: кнопки в боте. Выбранная услуга становится тегом лида. */
export const SERVICES = [
  { key: "site", label: "Сайт", tag: "Сайт" },
  { key: "ads", label: "Реклама", tag: "Реклама" },
  { key: "smm", label: "SMM", tag: "SMM" },
  { key: "other", label: "Другое", tag: "Другое" },
] as const;
