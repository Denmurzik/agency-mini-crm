import type { NextRequest } from "next/server";
import { toLeadRow, toMessageDTO, type LeadDetailDTO } from "@/components/leads/types";
import { getDb } from "@/lib/db";
import { getLead } from "@/lib/leads/queries";

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const detail = await getLead(getDb(), id);
    if (!detail) return Response.json({ error: "Лид не найден" }, { status: 404 });
    const body: LeadDetailDTO = { lead: toLeadRow(detail.lead), messages: detail.messages.map(toMessageDTO) };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("GET /api/leads/[id] failed", err);
    return Response.json({ error: "Не удалось загрузить лид" }, { status: 500 });
  }
}
