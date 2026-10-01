import type { Lead, LeadSource, LeadStatus, Message, Tag } from "@/lib/db/schema";

// Клиентские DTO: даты — строки ISO, потому что список приходит по JSON (поллинг).
export type TagDTO = { id: number; name: string; color: string };
export type TagCountDTO = TagDTO & { count: number };

export type LeadRowDTO = {
  id: number;
  name: string;
  contact: string | null;
  request: string | null;
  source: LeadSource;
  status: LeadStatus;
  tgUserId: number | null;
  tgUsername: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  tags: TagDTO[];
};

export type MessageDTO = { id: number; source: LeadSource; text: string; createdAt: string };

export type LeadFacets = {
  /** Всего лидов без фильтров. */
  total: number;
  status: Record<LeadStatus, number>;
  /** Все теги; count — с учётом остальных фильтров. */
  tags: TagCountDTO[];
};

export type LeadsPayload = { leads: LeadRowDTO[]; facets: LeadFacets };
export type LeadDetailDTO = { lead: LeadRowDTO; messages: MessageDTO[] };

export function toTagDTO(t: Tag): TagDTO {
  return { id: t.id, name: t.name, color: t.color };
}

export function toLeadRow(lead: Lead & { tags: Tag[] }): LeadRowDTO {
  return {
    id: lead.id,
    name: lead.name,
    contact: lead.contact,
    request: lead.request,
    source: lead.source,
    status: lead.status,
    tgUserId: lead.tgUserId,
    tgUsername: lead.tgUsername,
    isDemo: lead.isDemo,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    lastActivityAt: lead.lastActivityAt.toISOString(),
    tags: lead.tags.map(toTagDTO),
  };
}

export function toMessageDTO(m: Message): MessageDTO {
  return { id: m.id, source: m.source, text: m.text, createdAt: m.createdAt.toISOString() };
}
