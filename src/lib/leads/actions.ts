"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ingestLead } from "@/lib/leads/ingest";
import { addTagToLead, deleteLead, removeTagFromLead, updateLead, type LeadPatch } from "@/lib/leads/queries";
import { normalizeTagName } from "@/lib/tags";
import { toTagDTO, type TagDTO } from "@/components/leads/types";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

const status = z.enum(["new", "in_progress", "won", "lost"]);
const id = z.number().int().positive();
// Пустая строка из формы = «очистить поле».
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Не длиннее ${max} символов`)
    .transform((v) => v || null);

const createSchema = z.object({
  name: z.string().trim().min(1, "Укажите имя").max(120, "Имя не длиннее 120 символов"),
  contact: nullableText(200).optional(),
  request: nullableText(4000).optional(),
  status: status.optional(),
  tags: z.array(z.string()).max(20, "Не больше 20 тегов").optional(),
});

const patchSchema = z.object({
  name: z.string().trim().min(1, "Имя не может быть пустым").max(120, "Имя не длиннее 120 символов").optional(),
  contact: nullableText(200).optional(),
  request: nullableText(4000).optional(),
  status: status.optional(),
});

async function guard<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    await requireSession();
    return await fn();
  } catch (err) {
    if (err instanceof Error && err.message === "Требуется вход") return { ok: false, error: err.message };
    console.error("lead action failed", err);
    return { ok: false, error: "Не удалось выполнить действие, попробуйте ещё раз" };
  }
}

function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Некорректные данные";
}

export async function createLeadAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  return guard(async () => {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const { name, contact, request, status, tags } = parsed.data;
    const { lead } = await ingestLead(getDb(), {
      source: "manual",
      name,
      contact,
      request,
      status,
      tags,
      message: request ? { text: request } : undefined,
    });
    return { ok: true, data: { id: lead.id } };
  });
}

export async function updateLeadAction(leadId: number, patch: unknown): Promise<ActionResult> {
  return guard(async () => {
    const parsedId = id.safeParse(leadId);
    const parsed = patchSchema.safeParse(patch);
    if (!parsedId.success || !parsed.success) return { ok: false, error: parsed.error ? firstError(parsed.error) : "Некорректные данные" };
    const lead = await updateLead(getDb(), parsedId.data, parsed.data as LeadPatch);
    return lead ? { ok: true, data: null } : { ok: false, error: "Лид не найден" };
  });
}

export async function addTagAction(leadId: number, name: string): Promise<ActionResult<TagDTO>> {
  return guard(async () => {
    const tagName = normalizeTagName(String(name));
    if (!id.safeParse(leadId).success || !tagName) return { ok: false, error: "Введите название тега" };
    const tag = await addTagToLead(getDb(), leadId, tagName);
    return tag ? { ok: true, data: toTagDTO(tag) } : { ok: false, error: "Не удалось добавить тег" };
  });
}

export async function removeTagAction(leadId: number, tagId: number): Promise<ActionResult> {
  return guard(async () => {
    if (!id.safeParse(leadId).success || !id.safeParse(tagId).success) return { ok: false, error: "Некорректные данные" };
    await removeTagFromLead(getDb(), leadId, tagId);
    return { ok: true, data: null };
  });
}

export async function deleteLeadAction(leadId: number): Promise<ActionResult> {
  return guard(async () => {
    if (!id.safeParse(leadId).success) return { ok: false, error: "Некорректные данные" };
    return (await deleteLead(getDb(), leadId)) ? { ok: true, data: null } : { ok: false, error: "Лид уже удалён" };
  });
}
