import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true, db: true });
  } catch (err) {
    console.error("[health] db check failed", err);
    return Response.json({ ok: false, db: false }, { status: 503 });
  }
}
