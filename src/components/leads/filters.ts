import type { LeadSource, LeadStatus } from "@/lib/db/schema";

// Дублируем значения enum'а из схемы: клиентский бандл не должен тянуть drizzle.
export const STATUSES = ["new", "in_progress", "won", "lost"] as const satisfies readonly LeadStatus[];
export const SOURCES = ["bot", "telegram", "manual"] as const satisfies readonly LeadSource[];

export type LeadFilters = {
  q: string;
  status: LeadStatus | null;
  source: LeadSource | null;
  tag: string | null;
};

export const EMPTY_FILTERS: LeadFilters = { q: "", status: null, source: null, tag: null };

type Getter = (key: string) => string | null | undefined;

export function parseFilters(get: Getter): LeadFilters {
  const status = get("status");
  const source = get("source");
  return {
    q: (get("q") ?? "").trim().slice(0, 100),
    status: STATUSES.find((s) => s === status) ?? null,
    source: SOURCES.find((s) => s === source) ?? null,
    tag: get("tag")?.trim() || null,
  };
}

export function filtersToParams(f: LeadFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.status) params.set("status", f.status);
  if (f.source) params.set("source", f.source);
  if (f.tag) params.set("tag", f.tag);
  return params;
}

/** Стабильный ключ фильтров: по нему поллинг понимает, что список сменился. */
export function filtersKey(f: LeadFilters): string {
  return filtersToParams(f).toString();
}

export function hasFilters(f: LeadFilters): boolean {
  return filtersKey(f) !== "";
}
