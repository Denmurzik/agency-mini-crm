import { eq } from "drizzle-orm";
import type { Bot } from "grammy";
import { GrammyError } from "grammy";
import type { BusinessConnection, Update } from "grammy/types";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { botSessions, leads, messages, tgBusinessConnections } from "@/lib/db/schema";
import { createTestDb } from "@/test/db";
import { buildBotInfo, createBot } from "./bot";
import { businessMessageText, getBusinessStatus } from "./business";

const TOKEN = "123456:TEST";
const OWNER = { id: 111, is_bot: false, first_name: "Владелец", last_name: "Агентства", username: "owner" };
const CLIENT = { id: 900, is_bot: false, first_name: "Анна", last_name: "Смирнова", username: "anna_s" };
const CONN = "conn-1";

type Call = { method: string; payload: Record<string, unknown> };

describe("Telegram Business", () => {
  let db: Db;
  let bot: Bot;
  let calls: Call[];
  let connection: BusinessConnection;
  let getConnectionError: Error | null;
  let nextUpdate: number;

  beforeEach(async () => {
    db = await createTestDb();
    calls = [];
    nextUpdate = 1;
    getConnectionError = null;
    connection = { id: CONN, user: OWNER, user_chat_id: OWNER.id, date: 0, is_enabled: true } as BusinessConnection;
    bot = createBot({ token: TOKEN, db, botInfo: buildBotInfo(TOKEN, "agency_bot"), ingestOptions: { notify: false } });
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload: payload as unknown as Record<string, unknown> });
      if (method === "getBusinessConnection") {
        if (getConnectionError) throw getConnectionError;
        return { ok: true, result: connection } as never;
      }
      return { ok: true, result: true } as never;
    });
  });

  let messageId = 1000;
  const businessMessage = (from: object, extra: Record<string, unknown>, id = ++messageId): Update =>
    ({
      update_id: nextUpdate++,
      business_message: {
        message_id: id,
        date: 0,
        business_connection_id: CONN,
        // в личном чате chat.id — собеседник владельца, даже когда пишет сам владелец
        chat: { id: CLIENT.id, type: "private", first_name: CLIENT.first_name },
        from,
        ...extra,
      },
    }) as Update;
  const connectionUpdate = (over: Partial<BusinessConnection> = {}): Update =>
    ({ update_id: nextUpdate++, business_connection: { ...connection, ...over } }) as Update;

  const apiMethods = () => calls.map((c) => c.method);

  it("an incoming message creates a lead with name, @username contact, text and a biz externalId", async () => {
    await bot.handleUpdate(businessMessage(CLIENT, { text: "Здравствуйте, нужен сайт" }, 5));
    const [lead] = await db.select().from(leads);
    expect(lead).toMatchObject({
      name: "Анна Смирнова",
      contact: "@anna_s",
      request: "Здравствуйте, нужен сайт",
      source: "telegram",
      status: "new",
      tgUserId: CLIENT.id,
      tgUsername: "anna_s",
    });
    const [msg] = await db.select().from(messages);
    expect(msg).toMatchObject({ externalId: `biz:${CONN}:${CLIENT.id}:5`, text: "Здравствуйте, нужен сайт", source: "telegram" });
  });

  it("the unknown connection is fetched with getBusinessConnection and saved", async () => {
    await bot.handleUpdate(businessMessage(CLIENT, { text: "привет" }));
    expect(apiMethods().filter((m) => m === "getBusinessConnection")).toHaveLength(1);
    const [row] = await db.select().from(tgBusinessConnections);
    expect(row).toMatchObject({
      id: CONN,
      ownerTgUserId: OWNER.id,
      ownerUsername: "owner",
      ownerName: "Владелец Агентства",
      isEnabled: true,
    });
    expect(row.lastMessageAt).not.toBeNull();

    // известное подключение повторно не запрашивается
    await bot.handleUpdate(businessMessage(CLIENT, { text: "ещё" }));
    expect(apiMethods().filter((m) => m === "getBusinessConnection")).toHaveLength(1);
  });

  it("an outgoing message from the owner is ignored", async () => {
    await bot.handleUpdate(connectionUpdate());
    await bot.handleUpdate(businessMessage(OWNER, { text: "Добрый день! Чем помочь?" }));
    expect(await db.select().from(leads)).toHaveLength(0);
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  it("bots and non-private chats are ignored", async () => {
    await bot.handleUpdate(connectionUpdate());
    await bot.handleUpdate(businessMessage({ ...CLIENT, is_bot: true }, { text: "я бот" }));
    await bot.handleUpdate(businessMessage(CLIENT, { text: "группа", chat: { id: -5, type: "group", title: "g" } }));
    expect(await db.select().from(leads)).toHaveLength(0);
  });

  it("a redelivered message creates no duplicate; a second message is added to the same lead", async () => {
    const first = businessMessage(CLIENT, { text: "привет" }, 7);
    await bot.handleUpdate(first);
    await bot.handleUpdate({ ...first, update_id: nextUpdate++ } as Update);
    expect(await db.select().from(leads)).toHaveLength(1);
    expect(await db.select().from(messages)).toHaveLength(1);

    await bot.handleUpdate(businessMessage(CLIENT, { text: "и ещё вопрос" }, 8));
    expect(await db.select().from(leads)).toHaveLength(1);
    expect(await db.select().from(messages)).toHaveLength(2);
  });

  it("business_connection with is_enabled=false marks the connection disabled; enabling restores it", async () => {
    await bot.handleUpdate(connectionUpdate());
    expect((await db.select().from(tgBusinessConnections))[0].isEnabled).toBe(true);
    await bot.handleUpdate(connectionUpdate({ is_enabled: false }));
    expect((await db.select().from(tgBusinessConnections))[0].isEnabled).toBe(false);
    expect(await getBusinessStatus(db)).toMatchObject({ connected: false, ownerUsername: "owner" });
    await bot.handleUpdate(connectionUpdate({ is_enabled: true }));
    expect((await db.select().from(tgBusinessConnections))[0].isEnabled).toBe(true);
    expect(await db.select().from(tgBusinessConnections)).toHaveLength(1);
  });

  it("NEVER replies in business chats: no send* calls, no dialog state, even for /start", async () => {
    await bot.handleUpdate(connectionUpdate());
    await bot.handleUpdate(
      businessMessage(CLIENT, { text: "/start", entities: [{ type: "bot_command", offset: 0, length: 6 }] }),
    );
    await bot.handleUpdate(businessMessage(CLIENT, { text: "обычный текст" }));
    await bot.handleUpdate(businessMessage(CLIENT, { text: "/cancel", entities: [{ type: "bot_command", offset: 0, length: 7 }] }));
    await bot.handleUpdate(businessMessage(CLIENT, { sticker: { file_id: "x" } }));

    expect(apiMethods().filter((m) => m !== "getBusinessConnection")).toEqual([]);
    expect(await db.select().from(botSessions)).toHaveLength(0);
    expect(await db.select().from(leads)).toHaveLength(1);
    expect(await db.select().from(messages)).toHaveLength(4);
  });

  it("a permanent getBusinessConnection error (400) skips the message, a transient one is thrown", async () => {
    getConnectionError = new GrammyError(
      "x",
      { ok: false, error_code: 400, description: "BUSINESS_CONNECTION_INVALID" },
      "getBusinessConnection",
      {},
    );
    await expect(bot.handleUpdate(businessMessage(CLIENT, { text: "a" }))).resolves.toBeUndefined();
    expect(await db.select().from(leads)).toHaveLength(0);

    getConnectionError = new Error("network down");
    await expect(bot.handleUpdate(businessMessage(CLIENT, { text: "a" }))).rejects.toThrow();
  });

  it("falls back to @username, then to «Без имени», for the lead name", async () => {
    await bot.handleUpdate(connectionUpdate());
    await bot.handleUpdate(
      businessMessage({ id: 901, is_bot: false, username: "just_user" }, { text: "x", chat: { id: 901, type: "private" } }),
    );
    await bot.handleUpdate(businessMessage({ id: 902, is_bot: false }, { text: "y", chat: { id: 902, type: "private" } }));
    const rows = await db.select().from(leads).orderBy(leads.tgUserId);
    expect(rows.map((r) => [r.name, r.contact])).toEqual([
      ["@just_user", "@just_user"],
      ["Без имени", null],
    ]);
  });

  describe("businessMessageText", () => {
    const t = (m: Record<string, unknown>) =>
      businessMessageText({ message_id: 1, date: 0, chat: { id: 1, type: "private" }, ...m } as never);

    it("uses text, caption or a placeholder for each media type", () => {
      expect(t({ text: "  привет  " })).toBe("привет");
      expect(t({ photo: [{}], caption: "смотри" })).toBe("смотри");
      expect(t({ photo: [{}] })).toBe("[фото]");
      expect(t({ voice: {} })).toBe("[голосовое сообщение]");
      expect(t({ video: {} })).toBe("[видео]");
      expect(t({ animation: {} })).toBe("[видео]");
      expect(t({ video_note: {} })).toBe("[видеосообщение]");
      expect(t({ sticker: {} })).toBe("[стикер]");
      expect(t({ document: {} })).toBe("[файл]");
      expect(t({ audio: {} })).toBe("[файл]");
      expect(t({ location: {} })).toBe("[сообщение без текста]");
    });

    it("truncates long text to 4000 characters", () => {
      expect(t({ text: "я".repeat(5000) })).toHaveLength(4000);
    });
  });

  describe("getBusinessStatus", () => {
    it("is null when there are no connections", async () => {
      expect(await getBusinessStatus(db)).toBeNull();
    });

    it("reports the owner, state and last message time", async () => {
      await bot.handleUpdate(businessMessage(CLIENT, { text: "привет" }));
      const status = await getBusinessStatus(db);
      expect(status).toMatchObject({ connected: true, ownerName: "Владелец Агентства", ownerUsername: "owner" });
      expect(status?.lastMessageAt).toBeInstanceOf(Date);
    });

    it("prefers an enabled connection over a newer disabled one", async () => {
      await db.insert(tgBusinessConnections).values({ id: "old", ownerTgUserId: 1, isEnabled: true });
      await db.insert(tgBusinessConnections).values({ id: "new", ownerTgUserId: 2, ownerName: "Другой", isEnabled: false });
      expect((await getBusinessStatus(db))?.connected).toBe(true);
      await db.update(tgBusinessConnections).set({ isEnabled: false }).where(eq(tgBusinessConnections.id, "old"));
      expect((await getBusinessStatus(db))?.connected).toBe(false);
    });
  });
});
