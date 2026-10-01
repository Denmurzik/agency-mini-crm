import { GrammyError } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import { notifySubscribers, type Lead } from "@/lib/db/schema";
import type { LeadEvent } from "@/lib/leads/ingest";
import { createTestDb } from "@/test/db";
import { formatLeadMessage, notifyLead } from "./notify";

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: 7,
  name: "Иван <b>",
  contact: "@ivan & co",
  request: null,
  source: "bot",
  status: "new",
  tgUserId: 1,
  tgUsername: null,
  isDemo: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastActivityAt: new Date(),
  ...over,
});

const event = (over: Partial<LeadEvent> = {}): LeadEvent => ({
  kind: "new",
  lead: lead(),
  tags: ["Сайт", "SMM"],
  text: "Нужен <script>сайт</script>",
  ...over,
});

describe("formatLeadMessage", () => {
  it("formats a new lead with escaped user content and a card link", () => {
    const text = formatLeadMessage(event(), "https://crm.example.com/");
    expect(text).toContain("🆕 <b>Новый лид</b>");
    expect(text).toContain("<b>Имя:</b> Иван &lt;b&gt;");
    expect(text).toContain("<b>Контакт:</b> @ivan &amp; co");
    expect(text).toContain("<b>Источник:</b> Бот");
    expect(text).toContain("<b>Теги:</b> Сайт, SMM");
    expect(text).toContain("Нужен &lt;script&gt;сайт&lt;/script&gt;");
    expect(text).toContain('<a href="https://crm.example.com/?lead=7">');
  });

  it("marks a repeat contact and omits missing parts", () => {
    const text = formatLeadMessage(event({ kind: "repeat", tags: [], text: null, lead: lead({ contact: null }) }));
    expect(text).toContain("🔁 <b>Повторное обращение</b>");
    expect(text).not.toContain("Контакт");
    expect(text).not.toContain("Теги");
    expect(text).not.toContain("href");
  });

  it("truncates a long request", () => {
    const text = formatLeadMessage(event({ text: "я".repeat(900) }));
    expect(text).toContain("я".repeat(500) + "…");
    expect(text).not.toContain("я".repeat(501));
  });
});

describe("notifyLead", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
    await db.insert(notifySubscribers).values([{ chatId: 1 }, { chatId: 2 }]);
  });

  it("is a no-op without a bot token", async () => {
    await expect(notifyLead(event(), db, null)).resolves.toBeUndefined();
  });

  it("sends an HTML message to every subscriber", async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    await notifyLead(event(), db, { sendMessage } as never);
    expect(sendMessage.mock.calls.map((c) => c[0]).sort()).toEqual([1, 2]);
    expect(sendMessage.mock.calls[0][2]).toMatchObject({ parse_mode: "HTML" });
  });

  it("removes a subscriber who blocked the bot (403) and keeps the others", async () => {
    const sendMessage = vi.fn(async (chatId: number) => {
      if (chatId === 1) throw new GrammyError("blocked", { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }, "sendMessage", {});
      return {};
    });
    await notifyLead(event(), db, { sendMessage } as never);
    const left = await db.select().from(notifySubscribers);
    expect(left.map((s) => s.chatId)).toEqual([2]);
  });

  it("keeps the subscriber on other errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sendMessage = vi.fn().mockRejectedValue(new Error("network"));
    await notifyLead(event(), db, { sendMessage } as never);
    expect(await db.select().from(notifySubscribers)).toHaveLength(2);
    spy.mockRestore();
  });
});
