import { Suspense } from "react";
import { LeadsView } from "@/components/leads/leads-view";
import { filtersKey, parseFilters } from "@/components/leads/filters";
import { toLeadRow, type LeadsPayload } from "@/components/leads/types";
import { getDb } from "@/lib/db";
import { getLeadFacets, listLeads } from "@/lib/leads/queries";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const filters = parseFilters((k) => first(params[k]));

  const db = getDb();
  const [rows, facets] = await Promise.all([listLeads(db, filters), getLeadFacets(db, filters)]);
  const initial: LeadsPayload = { leads: rows.map(toLeadRow), facets };

  return (
    <Suspense>
      <LeadsView initial={initial} initialKey={filtersKey(filters)} botUsername={process.env.TELEGRAM_BOT_USERNAME ?? null} />
    </Suspense>
  );
}
