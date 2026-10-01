import { and, asc, count, desc, eq, exists, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { leads, leadTags, messages, tags, type Lead, type LeadStatus, type Message, type Tag } from "@/lib/db/schema";
import { ensureTags } from "@/lib/tags";
import type { LeadFilters } from "@/components/leads/filters";
import type { LeadFacets, TagCountDTO } from "@/components/leads/types";

export type LeadWithTags = Lead & { tags: Tag[] };
export type LeadDetail = { lead: LeadWithTags; messages: Message[] };
export type LeadPatch = Partial<Pick<Lead, "name" | "contact" | "request" | "status">>;

const STATUS_VALUES: LeadStatus[] = ["new", "in_progress", "won", "lost"];
const MAX_LEADS = 500;

/**
 * Условия фильтра. `skip` — выкинуть собственное измерение: счётчики статусов считаются
 * без фильтра по статусу (иначе у соседних вкладок были бы нули), счётчики тегов — без фильтра по тегу.
 */
function conditions(f: Partial<LeadFilters>, skip?: "status" | "tag"): SQL[] {
  const out: SQL[] = [];
  const q = f.q?.trim();
  if (q) {
    // Экранируем спецсимволы LIKE, чтобы «50%» искалось буквально.
    const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const search = or(ilike(leads.name, pattern), ilike(leads.contact, pattern), ilike(leads.request, pattern));
    if (search) out.push(search);
  }
  if (f.status && skip !== "status") out.push(eq(leads.status, f.status));
  if (f.source) out.push(eq(leads.source, f.source));
  if (f.tag && skip !== "tag") {
    const tag = f.tag;
    out.push(
      exists(
        // Имя тега сравниваем без учёта регистра — как уникальный индекс тегов.
        sql`(select 1 from ${leadTags} inner join ${tags} on ${tags.id} = ${leadTags.tagId} where ${leadTags.leadId} = ${leads.id} and lower(${tags.name}) = lower(${tag}))`,
      ),
    );
  }
  return out;
}

async function attachTags(db: Db, rows: Lead[]): Promise<LeadWithTags[]> {
  if (rows.length === 0) return [];
  const links = await db
    .select({ leadId: leadTags.leadId, tag: tags })
    .from(leadTags)
    .innerJoin(tags, eq(tags.id, leadTags.tagId))
    .where(
      inArray(
        leadTags.leadId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(tags.name));
  const byLead = new Map<number, Tag[]>();
  for (const { leadId, tag } of links) byLead.set(leadId, [...(byLead.get(leadId) ?? []), tag]);
  return rows.map((r) => ({ ...r, tags: byLead.get(r.id) ?? [] }));
}

/** Лиды по фильтрам, свежая активность сверху. */
export async function listLeads(db: Db, filters: Partial<LeadFilters> = {}, limit = MAX_LEADS): Promise<LeadWithTags[]> {
  const rows = await db
    .select()
    .from(leads)
    .where(and(...conditions(filters)))
    .orderBy(desc(leads.lastActivityAt), desc(leads.id))
    .limit(limit);
  return attachTags(db, rows);
}

/** Все теги со счётчиком лидов (с учётом остальных фильтров), частые сверху. */
export async function listTagsWithCounts(db: Db, filters: Partial<LeadFilters> = {}): Promise<TagCountDTO[]> {
  const [allTags, counts] = await Promise.all([
    db.select().from(tags),
    db
      .select({ tagId: leadTags.tagId, n: count() })
      .from(leadTags)
      .innerJoin(leads, eq(leads.id, leadTags.leadId))
      .where(and(...conditions(filters, "tag")))
      .groupBy(leadTags.tagId),
  ]);
  const byTag = new Map(counts.map((c) => [c.tagId, c.n]));
  return allTags
    .map((t) => ({ id: t.id, name: t.name, color: t.color, count: byTag.get(t.id) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru"));
}

export async function getLeadFacets(db: Db, filters: Partial<LeadFilters> = {}): Promise<LeadFacets> {
  const [statusRows, [totalRow], tagCounts] = await Promise.all([
    db
      .select({ status: leads.status, n: count() })
      .from(leads)
      .where(and(...conditions(filters, "status")))
      .groupBy(leads.status),
    db.select({ n: count() }).from(leads),
    listTagsWithCounts(db, filters),
  ]);
  const status = Object.fromEntries(STATUS_VALUES.map((s) => [s, 0])) as Record<LeadStatus, number>;
  for (const row of statusRows) status[row.status] = row.n;
  return { total: totalRow?.n ?? 0, status, tags: tagCounts };
}

export async function getLead(db: Db, id: number): Promise<LeadDetail | null> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, id));
  if (!lead) return null;
  const [[withTags], history] = await Promise.all([
    attachTags(db, [lead]),
    db.select().from(messages).where(eq(messages.leadId, id)).orderBy(asc(messages.createdAt), asc(messages.id)),
  ]);
  return { lead: withTags, messages: history };
}

export async function updateLead(db: Db, id: number, patch: LeadPatch): Promise<Lead | null> {
  const [row] = await db
    .update(leads)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(leads.id, id))
    .returning();
  return row ?? null;
}

/** Вешает тег (создаёт при отсутствии). Повторное добавление — no-op. */
export async function addTagToLead(db: Db, leadId: number, name: string): Promise<Tag | null> {
  const [tag] = await ensureTags(db, [name]);
  if (!tag) return null;
  await db.insert(leadTags).values({ leadId, tagId: tag.id }).onConflictDoNothing();
  await db.update(leads).set({ updatedAt: new Date() }).where(eq(leads.id, leadId));
  return tag;
}

export async function removeTagFromLead(db: Db, leadId: number, tagId: number): Promise<void> {
  await db.delete(leadTags).where(and(eq(leadTags.leadId, leadId), eq(leadTags.tagId, tagId)));
  await db.update(leads).set({ updatedAt: new Date() }).where(eq(leads.id, leadId));
}

export async function deleteLead(db: Db, id: number): Promise<boolean> {
  const rows = await db.delete(leads).where(eq(leads.id, id)).returning({ id: leads.id });
  return rows.length > 0;
}
