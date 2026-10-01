// ЗАГЛУШКА: финальная сигнатура зафиксирована в плане (Контракт 1), реализацию пишет поток `core`.
import type { Db } from "@/lib/db";
import type { Lead, LeadSource, LeadStatus } from "@/lib/db/schema";

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

export async function ingestLead(_db: Db, _input: IngestInput, _opts?: IngestOptions): Promise<IngestResult> {
  throw new Error("ingestLead: not implemented");
}
