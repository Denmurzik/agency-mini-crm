import type { NextRequest } from "next/server";
import { parseFilters } from "@/components/leads/filters";
import { toLeadRow, type LeadsPayload } from "@/components/leads/types";
import { getDb } from "@/lib/db";
import { getLeadFacets, listLeads } from "@/lib/leads/queries";

/** Список лидов для поллинга UI. Закрыт сессией в `proxy.ts`. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const filters = parseFilters((key) => params.get(key));
  try {
    const db = getDb();
    const [rows, facets] = await Promise.all([listLeads(db, filters), getLeadFacets(db, filters)]);
    const body: LeadsPayload = { leads: rows.map(toLeadRow), facets };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("GET /api/leads failed", err);
    return Response.json({ error: "Не удалось загрузить лидов" }, { status: 500 });
  }
}
