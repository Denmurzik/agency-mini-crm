import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { leads, leadTags, messages, tags, type Lead, type LeadSource, type LeadStatus } from "@/lib/db/schema";
import { notifyLead } from "@/lib/notify";
import { ensureTags } from "@/lib/tags";

export type IngestInput = {
  source: LeadSource;
  name: string;
  contact?: string | null;
  request?: string | null;
  tgUserId?: number | null;
  tgUsername?: string | null;
  tags?: string[];
  status?: LeadStatus;
  isDemo?: boolean;
  message?: { text: string; externalId?: string | null };
};

export type IngestResult = { lead: Lead; created: boolean; duplicate: boolean };

export type LeadEvent = { kind: "new" | "repeat"; lead: Lead; tags: string[]; text: string | null };

export type IngestOptions = { notify?: boolean; notifier?: (e: LeadEvent) => Promise<void> };

/** Повторная доставка того же сообщения, обнаруженная внутри транзакции: откатываем её целиком. */
class DuplicateMessageError extends Error {}

const isEmpty = (v: string | null | undefined) => v == null || v.trim() === "";
const clean = (v: string | null | undefined) => (isEmpty(v) ? null : v!.trim());

/**
 * Единая точка создания лида (спека §4.1): дедуп по tgUserId, теги, история, уведомление.
 * Запись — в одной транзакции; уведомление — после неё, его ошибки лид не роняют.
 */
export async function ingestLead(db: Db, input: IngestInput, opts: IngestOptions = {}): Promise<IngestResult> {
  const externalId = input.message?.externalId ?? null;

  let outcome: WriteOutcome;
  try {
    outcome = await db.transaction((tx) => write(tx as unknown as Db, input));
  } catch (err) {
    if (!(err instanceof DuplicateMessageError) || !externalId) throw err;
    // Параллельная доставка того же сообщения успела раньше нас.
    const lead = await findLeadByMessage(db, input.source, externalId);
    if (!lead) throw err;
    return { lead, created: false, duplicate: true };
  }
  if (outcome.duplicate) return { lead: outcome.lead, created: false, duplicate: true };

  const { lead, created, tagNames } = outcome;
  const shouldNotify = opts.notify ?? input.source !== "manual";
  if (shouldNotify) {
    const notifier = opts.notifier ?? ((e: LeadEvent) => notifyLead(e, db));
    try {
      await notifier({
        kind: created ? "new" : "repeat",
        lead,
        tags: tagNames,
        text: clean(input.request) ?? clean(input.message?.text),
      });
    } catch (err) {
      console.error("[ingest] notify failed", err);
    }
  }
  return { lead, created, duplicate: false };
}

async function findLeadByMessage(db: Db, source: LeadSource, externalId: string): Promise<Lead | undefined> {
  const [row] = await db
    .select({ lead: leads })
    .from(messages)
    .innerJoin(leads, eq(leads.id, messages.leadId))
    .where(and(eq(messages.source, source), eq(messages.externalId, externalId)))
    .limit(1);
  return row?.lead;
}

type WriteOutcome = { lead: Lead; created: boolean; duplicate: boolean; tagNames: string[] };

async function write(tx: Db, input: IngestInput): Promise<WriteOutcome> {
  const externalId = input.message?.externalId ?? null;

  // 1. Защита от повторной доставки: ничего не меняем.
  if (externalId) {
    const existing = await findLeadByMessage(tx, input.source, externalId);
    if (existing) return { lead: existing, duplicate: true, created: false, tagNames: [] };
  }

  const name = clean(input.name) ?? "Без имени";
  const contact = clean(input.contact);
  const request = clean(input.request);
  const tgUsername = clean(input.tgUsername)?.replace(/^@/, "") ?? null;
  const tgUserId = input.tgUserId ?? null;

  // 2. Существующий лид по tgUserId либо создание. Гонку двух вебхуков решает on conflict.
  let lead: Lead | undefined;
  let created = false;
  if (tgUserId != null) {
    [lead] = await tx.select().from(leads).where(eq(leads.tgUserId, tgUserId)).limit(1);
  }
  if (!lead) {
    [lead] = await tx
      .insert(leads)
      .values({
        name,
        contact,
        request,
        source: input.source,
        status: input.status ?? "new",
        tgUserId,
        tgUsername,
        isDemo: input.isDemo ?? false,
      })
      .onConflictDoNothing({ target: leads.tgUserId })
      .returning();
    if (lead) {
      created = true;
    } else {
      // Конкурентный запрос создал лида между нашим select и insert.
      [lead] = await tx.select().from(leads).where(eq(leads.tgUserId, tgUserId!)).limit(1);
      if (!lead) throw new Error("ingestLead: lead vanished after insert conflict");
    }
  }

  if (!created) {
    // Имя не трогаем: менеджер мог его поправить. Дозаполняем только пустое.
    const reopen = lead.status === "won" || lead.status === "lost";
    [lead] = await tx
      .update(leads)
      .set({
        contact: isEmpty(lead.contact) ? contact : lead.contact,
        request: isEmpty(lead.request) ? request : lead.request,
        tgUsername: isEmpty(lead.tgUsername) ? tgUsername : lead.tgUsername,
        status: reopen ? "new" : lead.status,
        updatedAt: sql`now()`,
        lastActivityAt: sql`now()`,
      })
      .where(eq(leads.id, lead.id))
      .returning();
  }

  // 3. Теги.
  const ensured = await ensureTags(tx, input.tags ?? []);
  if (ensured.length > 0) {
    await tx
      .insert(leadTags)
      .values(ensured.map((t) => ({ leadId: lead.id, tagId: t.id })))
      .onConflictDoNothing();
  }
  const tagRows = await tx
    .select({ name: tags.name })
    .from(leadTags)
    .innerJoin(tags, eq(tags.id, leadTags.tagId))
    .where(eq(leadTags.leadId, lead.id))
    .orderBy(tags.id);

  // 4. История: без явного сообщения исходная заявка всё равно попадает в карточку.
  const text = input.message ? input.message.text : request;
  if (text != null && text.trim() !== "") {
    const inserted = await tx
      .insert(messages)
      .values({ leadId: lead.id, source: input.source, text, externalId })
      .onConflictDoNothing()
      .returning({ id: messages.id });
    if (inserted.length === 0 && externalId) throw new DuplicateMessageError();
  }

  return { lead, created, duplicate: false, tagNames: tagRows.map((r) => r.name) };
}
