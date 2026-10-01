import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import { leads, leadTags, messages, tags } from "@/lib/db/schema";
import { createTestDb } from "@/test/db";
import { ingestLead, type LeadEvent } from "./ingest";

describe("ingestLead", () => {
  let db: Db;
  let events: LeadEvent[];
  const notifier = async (e: LeadEvent) => {
    events.push(e);
  };

  beforeEach(async () => {
    db = await createTestDb();
    events = [];
  });

  const tagNamesOf = async (leadId: number) =>
    (
      await db
        .select({ name: tags.name })
        .from(leadTags)
        .innerJoin(tags, eq(tags.id, leadTags.tagId))
        .where(eq(leadTags.leadId, leadId))
    )
      .map((r) => r.name)
      .sort();

  const messagesOf = (leadId: number) => db.select().from(messages).where(eq(messages.leadId, leadId));

  it("creates a lead with tags and the first message", async () => {
    const res = await ingestLead(
      db,
      {
        source: "bot",
        name: "Иван",
        contact: "+79990001122",
        request: "Нужен сайт",
        tgUserId: 111,
        tgUsername: "ivan",
        tags: ["Сайт"],
        message: { text: "сводка", externalId: "111:5" },
      },
      { notifier },
    );
    expect(res).toMatchObject({ created: true, duplicate: false });
    expect(res.lead).toMatchObject({ name: "Иван", status: "new", source: "bot", tgUserId: 111, isDemo: false });
    expect(await tagNamesOf(res.lead.id)).toEqual(["Сайт"]);
    const msgs = await messagesOf(res.lead.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ text: "сводка", externalId: "111:5", source: "bot" });
  });

  it("uses the requested status and isDemo for manual leads", async () => {
    const res = await ingestLead(db, { source: "manual", name: "Демо", status: "won", isDemo: true });
    expect(res.lead).toMatchObject({ status: "won", isDemo: true });
  });

  it("writes the request as the first message when no message is given", async () => {
    const { lead } = await ingestLead(db, { source: "manual", name: "Мария", request: "Хочу SMM" });
    const msgs = await messagesOf(lead.id);
    expect(msgs.map((m) => m.text)).toEqual(["Хочу SMM"]);
    expect(msgs[0].externalId).toBeNull();
  });

  it("writes no message when there is neither a message nor a request", async () => {
    const { lead } = await ingestLead(db, { source: "manual", name: "Пётр" });
    expect(await messagesOf(lead.id)).toHaveLength(0);
  });

  it("merges the bot and the private chat into one card by tgUserId", async () => {
    const first = await ingestLead(
      db,
      { source: "bot", name: "Иван (бот)", request: "Сайт", tgUserId: 7, tags: ["Сайт"], message: { text: "a", externalId: "7:1" } },
      { notifier },
    );
    const second = await ingestLead(
      db,
      {
        source: "telegram",
        name: "Иван из лички",
        contact: "@ivan",
        request: "Привет",
        tgUserId: 7,
        tgUsername: "ivan",
        message: { text: "Привет", externalId: "9:7:100" },
      },
      { notifier },
    );
    expect(second.lead.id).toBe(first.lead.id);
    expect(second).toMatchObject({ created: false, duplicate: false });
    expect(await db.select().from(leads)).toHaveLength(1);
    expect(await messagesOf(first.lead.id)).toHaveLength(2);
    // имя и существующий запрос не затираются, пустые поля дозаполняются
    expect(second.lead).toMatchObject({ name: "Иван (бот)", request: "Сайт", contact: "@ivan", tgUsername: "ivan" });
  });

  it("does not overwrite non-empty fields on a repeat contact", async () => {
    await ingestLead(db, { source: "bot", name: "А", contact: "+7999", request: "первый", tgUserId: 8, tgUsername: "a" });
    const { lead } = await ingestLead(db, {
      source: "telegram",
      name: "Б",
      contact: "@b",
      request: "второй",
      tgUserId: 8,
      tgUsername: "b",
    });
    expect(lead).toMatchObject({ name: "А", contact: "+7999", request: "первый", tgUsername: "a" });
  });

  it("fills a whitespace-only contact but keeps a manager's edit", async () => {
    const first = await ingestLead(db, { source: "bot", name: "А", contact: "  ", tgUserId: 10 });
    expect(first.lead.contact).toBeNull();
    await db.update(leads).set({ contact: " " }).where(eq(leads.id, first.lead.id));
    const filled = await ingestLead(db, { source: "telegram", name: "А", contact: "@a_user", tgUserId: 10 });
    expect(filled.lead.contact).toBe("@a_user");
    await db.update(leads).set({ contact: "+7 999 править", status: "in_progress" }).where(eq(leads.id, first.lead.id));
    const kept = await ingestLead(db, { source: "telegram", name: "А", contact: "@other", tgUserId: 10 });
    expect(kept.lead).toMatchObject({ contact: "+7 999 править", status: "in_progress" });
  });

  it("bumps updatedAt and lastActivityAt on a repeat contact", async () => {
    const { lead: first } = await ingestLead(db, { source: "bot", name: "А", tgUserId: 9 });
    await new Promise((r) => setTimeout(r, 15));
    const { lead } = await ingestLead(db, { source: "telegram", name: "А", tgUserId: 9, request: "ещё" });
    expect(lead.lastActivityAt.getTime()).toBeGreaterThan(first.lastActivityAt.getTime());
    expect(lead.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
  });

  it("is idempotent for the same message externalId", async () => {
    const input = {
      source: "bot" as const,
      name: "Иван",
      tgUserId: 21,
      tags: ["SMM"],
      message: { text: "заявка", externalId: "21:50" },
    };
    const first = await ingestLead(db, input, { notifier });
    const again = await ingestLead(db, input, { notifier });
    expect(again).toMatchObject({ created: false, duplicate: true });
    expect(again.lead.id).toBe(first.lead.id);
    expect(await messagesOf(first.lead.id)).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it("does not touch the lead on a duplicate delivery", async () => {
    const first = await ingestLead(db, {
      source: "telegram",
      name: "Иван",
      tgUserId: 22,
      message: { text: "a", externalId: "1:2:3" },
    });
    await db.update(leads).set({ status: "won" }).where(eq(leads.id, first.lead.id));
    const again = await ingestLead(db, {
      source: "telegram",
      name: "Иван",
      tgUserId: 22,
      tags: ["Новый"],
      message: { text: "a", externalId: "1:2:3" },
    });
    expect(again.duplicate).toBe(true);
    expect(again.lead.status).toBe("won");
    expect(await tagNamesOf(first.lead.id)).toEqual([]);
  });

  it("handles parallel deliveries of the same message and of the same user", async () => {
    const input = { source: "bot" as const, name: "Гонка", tgUserId: 31, message: { text: "x", externalId: "31:1" } };
    const results = await Promise.all([ingestLead(db, input, { notify: false }), ingestLead(db, input, { notify: false })]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(results[0].lead.id).toBe(results[1].lead.id);
    expect(await db.select().from(leads)).toHaveLength(1);
    expect(await messagesOf(results[0].lead.id)).toHaveLength(1);
  });

  it("merges tags without duplicates (case-insensitive)", async () => {
    const first = await ingestLead(db, { source: "bot", name: "Т", tgUserId: 41, tags: ["Сайт", "SMM"] });
    const second = await ingestLead(db, { source: "telegram", name: "Т", tgUserId: 41, tags: ["smm", "Реклама"] });
    expect(second.lead.id).toBe(first.lead.id);
    expect(await tagNamesOf(first.lead.id)).toEqual(["SMM", "Реклама", "Сайт"]);
    expect(await db.select().from(tags)).toHaveLength(3);
  });

  it.each(["won", "lost"] as const)("reopens a %s lead on a repeat contact", async (status) => {
    const first = await ingestLead(db, { source: "bot", name: "Закрытый", tgUserId: 51 });
    await db.update(leads).set({ status }).where(eq(leads.id, first.lead.id));
    const { lead } = await ingestLead(db, { source: "telegram", name: "Закрытый", tgUserId: 51, request: "снова" });
    expect(lead.status).toBe("new");
  });

  it("keeps in_progress status on a repeat contact", async () => {
    const first = await ingestLead(db, { source: "bot", name: "В работе", tgUserId: 52 });
    await db.update(leads).set({ status: "in_progress" }).where(eq(leads.id, first.lead.id));
    const { lead } = await ingestLead(db, { source: "telegram", name: "В работе", tgUserId: 52 });
    expect(lead.status).toBe("in_progress");
  });

  it("never merges leads without tgUserId", async () => {
    await ingestLead(db, { source: "manual", name: "Один" });
    await ingestLead(db, { source: "manual", name: "Один" });
    expect(await db.select().from(leads)).toHaveLength(2);
  });

  describe("notifications", () => {
    it("sends `new` for a created lead and `repeat` for a repeat contact, with tags and text", async () => {
      await ingestLead(db, { source: "bot", name: "Иван", request: "Нужен сайт", tgUserId: 61, tags: ["Сайт"] }, { notifier });
      await ingestLead(db, { source: "telegram", name: "Иван", request: "Ещё вопрос", tgUserId: 61, tags: ["SMM"] }, { notifier });
      expect(events.map((e) => e.kind)).toEqual(["new", "repeat"]);
      expect(events[0]).toMatchObject({ tags: ["Сайт"], text: "Нужен сайт" });
      expect(events[0].lead.name).toBe("Иван");
      expect(events[1].tags.sort()).toEqual(["SMM", "Сайт"]);
      expect(events[1].text).toBe("Ещё вопрос");
    });

    it("does not notify for manual leads by default, but does when asked", async () => {
      await ingestLead(db, { source: "manual", name: "Руками" }, { notifier });
      expect(events).toHaveLength(0);
      await ingestLead(db, { source: "manual", name: "Руками 2" }, { notifier, notify: true });
      expect(events).toHaveLength(1);
    });

    it("does not notify when notify is false", async () => {
      await ingestLead(db, { source: "bot", name: "Тихо" }, { notifier, notify: false });
      expect(events).toHaveLength(0);
    });

    it("does not fail when the notifier throws", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await ingestLead(
        db,
        { source: "bot", name: "Падает", tgUserId: 71 },
        {
          notifier: async () => {
            throw new Error("telegram is down");
          },
        },
      );
      expect(res.created).toBe(true);
      expect(await db.select().from(leads)).toHaveLength(1);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
