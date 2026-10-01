import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { leads, leadTags, messages, tags, type NewLead } from "@/lib/db/schema";
import { ensureTags } from "@/lib/tags";
import { createTestDb } from "@/test/db";
import {
  addTagToLead,
  deleteLead,
  getLead,
  getLeadFacets,
  listLeads,
  listTagsWithCounts,
  removeTagFromLead,
  updateLead,
} from "./queries";

async function seedLead(db: Db, values: Partial<NewLead> & { name: string }, tagNames: string[] = []) {
  const [lead] = await db
    .insert(leads)
    .values({ source: "manual", ...values })
    .returning();
  if (tagNames.length > 0) {
    const rows = await ensureTags(db, tagNames);
    await db.insert(leadTags).values(rows.map((t) => ({ leadId: lead.id, tagId: t.id })));
  }
  return lead;
}

describe("leads queries", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  describe("listLeads", () => {
    beforeEach(async () => {
      const day = 86_400_000;
      await seedLead(db, { name: "Анна Петрова", contact: "@anna", request: "Нужен сайт для кофейни", source: "bot", lastActivityAt: new Date(Date.now() - 3 * day) }, ["Сайт", "горячий"]);
      await seedLead(db, { name: "Игорь", contact: "+7 900 111-22-33", request: "Таргет в VK, бюджет 50%", source: "telegram", status: "in_progress", lastActivityAt: new Date(Date.now() - day) }, ["Реклама"]);
      await seedLead(db, { name: "Мария", request: "Ведение соцсетей", source: "manual", status: "won", lastActivityAt: new Date() }, ["smm"]);
    });

    it("sorts by last activity, newest first, and attaches tags", async () => {
      const rows = await listLeads(db);
      expect(rows.map((r) => r.name)).toEqual(["Мария", "Игорь", "Анна Петрова"]);
      expect(rows[2].tags.map((t) => t.name).sort()).toEqual(["Сайт", "горячий"]);
    });

    it("filters by tag case-insensitively", async () => {
      expect((await listLeads(db, { tag: "сайт" })).map((r) => r.name)).toEqual(["Анна Петрова"]);
      expect((await listLeads(db, { tag: "SMM" })).map((r) => r.name)).toEqual(["Мария"]);
      expect(await listLeads(db, { tag: "нет такого" })).toEqual([]);
    });

    it("filters by status and source", async () => {
      expect((await listLeads(db, { status: "won" })).map((r) => r.name)).toEqual(["Мария"]);
      expect((await listLeads(db, { source: "telegram" })).map((r) => r.name)).toEqual(["Игорь"]);
      expect(await listLeads(db, { status: "won", source: "bot" })).toEqual([]);
    });

    it("searches name, contact and request without regard to case", async () => {
      expect((await listLeads(db, { q: "анна" })).map((r) => r.name)).toEqual(["Анна Петрова"]);
      expect((await listLeads(db, { q: "900 111" })).map((r) => r.name)).toEqual(["Игорь"]);
      expect((await listLeads(db, { q: "СОЦСЕТЕЙ" })).map((r) => r.name)).toEqual(["Мария"]);
    });

    it("treats LIKE wildcards literally", async () => {
      expect((await listLeads(db, { q: "50%" })).map((r) => r.name)).toEqual(["Игорь"]);
      expect(await listLeads(db, { q: "%" })).toHaveLength(1);
      expect(await listLeads(db, { q: "_" })).toEqual([]);
    });

    it("combines filters", async () => {
      expect((await listLeads(db, { tag: "реклама", status: "in_progress", q: "vk" })).map((r) => r.name)).toEqual(["Игорь"]);
      expect(await listLeads(db, { tag: "реклама", q: "кофейн" })).toEqual([]);
    });
  });

  describe("facets", () => {
    it("counts statuses ignoring the status filter and tags ignoring the tag filter", async () => {
      await seedLead(db, { name: "A", status: "new" }, ["Сайт"]);
      await seedLead(db, { name: "B", status: "won" }, ["Сайт", "SMM"]);
      await seedLead(db, { name: "C", status: "won", source: "bot" }, ["SMM"]);
      await ensureTags(db, ["Пустой"]);

      const facets = await getLeadFacets(db, { status: "won", tag: "сайт" });
      expect(facets.total).toBe(3);
      // статусы — при фильтре тега «Сайт» (A: new, B: won)
      expect(facets.status).toEqual({ new: 1, in_progress: 0, won: 1, lost: 0 });
      // теги — при фильтре статуса «won» (B: Сайт+SMM, C: SMM)
      const byName = Object.fromEntries(facets.tags.map((t) => [t.name, t.count]));
      expect(byName).toEqual({ Сайт: 1, SMM: 2, Пустой: 0 });
      expect(facets.tags[0].name).toBe("SMM");
    });

    it("lists all tags with zero counts on an empty database", async () => {
      expect(await listTagsWithCounts(db)).toEqual([]);
      const facets = await getLeadFacets(db);
      expect(facets).toEqual({ total: 0, status: { new: 0, in_progress: 0, won: 0, lost: 0 }, tags: [] });
    });
  });

  describe("mutations", () => {
    it("returns a lead with tags and messages in chronological order", async () => {
      const lead = await seedLead(db, { name: "Анна" }, ["Сайт"]);
      await db.insert(messages).values([
        { leadId: lead.id, source: "bot", text: "второе", createdAt: new Date("2026-09-30T10:00:00Z") },
        { leadId: lead.id, source: "bot", text: "первое", createdAt: new Date("2026-09-29T10:00:00Z") },
      ]);
      const detail = await getLead(db, lead.id);
      expect(detail?.lead.tags.map((t) => t.name)).toEqual(["Сайт"]);
      expect(detail?.messages.map((m) => m.text)).toEqual(["первое", "второе"]);
      expect(await getLead(db, 9999)).toBeNull();
    });

    it("updates fields and bumps updated_at", async () => {
      const lead = await seedLead(db, { name: "Анна", updatedAt: new Date("2026-01-01T00:00:00Z") });
      const updated = await updateLead(db, lead.id, { name: "Анна П.", status: "in_progress", contact: null });
      expect(updated).toMatchObject({ name: "Анна П.", status: "in_progress", contact: null });
      expect(updated!.updatedAt.getTime()).toBeGreaterThan(lead.updatedAt.getTime());
      expect(await updateLead(db, 9999, { name: "x" })).toBeNull();
    });

    it("adds an existing or new tag once and removes it", async () => {
      const lead = await seedLead(db, { name: "Анна" }, ["Сайт"]);
      const same = await addTagToLead(db, lead.id, "  сайт ");
      const created = await addTagToLead(db, lead.id, "повторный клиент");
      await addTagToLead(db, lead.id, "Повторный клиент");

      expect(same?.name).toBe("Сайт");
      expect((await getLead(db, lead.id))?.lead.tags.map((t) => t.name).sort()).toEqual(["Сайт", "повторный клиент"]);
      expect(await db.select().from(tags)).toHaveLength(2);

      await removeTagFromLead(db, lead.id, created!.id);
      expect((await getLead(db, lead.id))?.lead.tags.map((t) => t.name)).toEqual(["Сайт"]);
    });

    it("deletes a lead together with its tag links and messages", async () => {
      const lead = await seedLead(db, { name: "Анна" }, ["Сайт"]);
      await db.insert(messages).values({ leadId: lead.id, source: "manual", text: "привет" });

      expect(await deleteLead(db, lead.id)).toBe(true);
      expect(await deleteLead(db, lead.id)).toBe(false);
      expect(await db.select().from(leadTags)).toEqual([]);
      expect(await db.select().from(messages)).toEqual([]);
      expect(await db.select().from(tags)).toHaveLength(1);
    });
  });
});
