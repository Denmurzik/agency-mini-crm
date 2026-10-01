import { inArray, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { tags, type Tag } from "@/lib/db/schema";

/** Палитра тегов (Tailwind-цвета). Цвет выбирается детерминированно по имени. */
export const TAG_COLORS = ["blue", "emerald", "amber", "rose", "violet", "cyan", "orange", "lime", "fuchsia", "slate"] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, 40);
}

export function pickTagColor(name: string): TagColor {
  let hash = 0;
  for (const ch of name.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_COLORS[hash % TAG_COLORS.length];
}

/**
 * Возвращает теги с указанными именами, создавая недостающие.
 * Имена сравниваются без учёта регистра: «SMM» и «smm» — один тег.
 */
export async function ensureTags(db: Db, names: string[]): Promise<Tag[]> {
  const unique = [...new Map(names.map(normalizeTagName).filter(Boolean).map((n) => [n.toLowerCase(), n])).values()];
  if (unique.length === 0) return [];
  await db
    .insert(tags)
    .values(unique.map((name) => ({ name, color: pickTagColor(name) })))
    .onConflictDoNothing();
  return db
    .select()
    .from(tags)
    .where(inArray(sql`lower(${tags.name})`, unique.map((n) => n.toLowerCase())));
}
