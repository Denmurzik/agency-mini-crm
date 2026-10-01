import { z } from "zod";
import { secretsEqual } from "@/lib/bot/secret";
import { getDb } from "@/lib/db";
import { ingestLead } from "@/lib/leads/ingest";

const bodySchema = z.object({
  source: z.literal("telegram"),
  name: z.string().trim().max(200),
  contact: z.string().max(200).nullish(),
  request: z.string().max(10000).nullish(),
  tgUserId: z.number().int().positive(),
  tgUsername: z.string().max(100).nullish(),
  message: z.object({ text: z.string().max(10000), externalId: z.string().min(1).max(200) }),
});

export async function POST(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  if (!secretsEqual(token, process.env.INGEST_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const { lead, created, duplicate } = await ingestLead(getDb(), parsed.data);
    return Response.json({ leadId: lead.id, created, duplicate });
  } catch (err) {
    console.error("[ingest] failed", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
