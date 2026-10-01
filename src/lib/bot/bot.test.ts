import { eq, sql } from "drizzle-orm";
import type { Update } from "grammy/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "grammy";
import type { Db } from "@/lib/db";
import { botSessions, leads, leadTags, messages, notifySubscribers, tags } from "@/lib/db/schema";
import { createTestDb } from "@/test/db";
import { buildBotInfo, createBot } from "./bot";
import { getNotifySubscribeUrl } from "@/lib/notify-token";

const TOKEN = "123456:TEST";
const CHAT = 5001;
const USER = { id: CHAT, is_bot: false, first_name: "Иван", last_name: "Петров", username: "ivan_p" };

type Button = { text: string; callback_data?: string; request_contact?: boolean };
type Payload = { text: string; reply_markup: { inline_keyboard: Button[][]; keyboard: Button[][]; remove_keyboard?: boolean } };
type Call = { method: string; payload: Payload };

describe("bot (grammY wiring, no network)", () => {
  let db: Db;
  let bot: Bot;
  let calls: Call[];
  let nextUpdate: number;
  let nextMessage: number;
  const saved = { ...process.env };

  beforeEach(async () => {
    process.env.AUTH_SECRET = "test-secret";
    process.env.TELEGRAM_BOT_USERNAME = "agency_bot";
    db = await createTestDb();
    calls = [];
    nextUpdate = 1;
    nextMessage = 100;
    bot = createBot({
      token: TOKEN,
      db,
      botInfo: buildBotInfo(TOKEN, "agency_bot"),
      ingestOptions: { notify: false },
    });
    // Вместо сети — запись вызовов и фейковые ответы.
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload: payload as unknown as Payload });
      const result = method === "sendMessage" ? { message_id: nextMessage++, date: 0, chat: { id: CHAT, type: "private" } } : true;
      return { ok: true, result } as never;
    });
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  const base = { update_id: 0 };
  const message = (extra: Record<string, unknown>): Update =>
    ({
      ...base,
      update_id: nextUpdate++,
      message: { message_id: nextMessage++, date: 0, chat: { id: CHAT, type: "private", first_name: "Иван" }, from: USER, ...extra },
    }) as Update;
  const text = (t: string) => message({ text: t });
  const command = (t: string) => message({ text: t, entities: [{ type: "bot_command", offset: 0, length: t.split(" ")[0].length }] });
  const callback = (data: string, messageId = 777) =>
    ({
      update_id: nextUpdate++,
      callback_query: {
        id: String(nextUpdate),
        from: USER,
        chat_instance: "x",
        data,
        message: { message_id: messageId, date: 0, chat: { id: CHAT, type: "private" } },
      },
    }) as Update;

  const sent = () => calls.filter((c) => c.method === "sendMessage").map((c) => c.payload);
  const lastSent = () => sent().at(-1)!;

  async function fillDialog(confirmMessageId = 777) {
    await bot.handleUpdate(command("/start"));
    await bot.handleUpdate(callback("svc:smm"));
    await bot.handleUpdate(text("Иван Петров"));
    await bot.handleUpdate(message({ contact: { phone_number: "79991234567", first_name: "Иван", user_id: CHAT } }));
    await bot.handleUpdate(text("Нужно вести соцсети"));
    return confirmMessageId;
  }

  it("full dialog creates a lead with the service tag, the summary message and replies with its number", async () => {
    await fillDialog();
    expect(lastSent().text).toContain("Услуга: SMM");
    expect(lastSent().text).toContain("Нажимая «Отправить»");
    expect(lastSent().reply_markup.inline_keyboard[0].map((b) => b.callback_data)).toEqual(["submit:1", "restart:1"]);
    expect(await db.select().from(leads)).toHaveLength(0);

    await bot.handleUpdate(callback("submit:1", 777));

    const [lead] = await db.select().from(leads);
    expect(lead).toMatchObject({
      name: "Иван Петров",
      contact: "+79991234567",
      request: "Нужно вести соцсети",
      source: "bot",
      status: "new",
      tgUserId: CHAT,
      tgUsername: "ivan_p",
    });
    const tagRows = await db
      .select({ name: tags.name })
      .from(leadTags)
      .innerJoin(tags, eq(tags.id, leadTags.tagId))
      .where(eq(leadTags.leadId, lead.id));
    expect(tagRows.map((t) => t.name)).toEqual(["SMM"]);
    const [msg] = await db.select().from(messages).where(eq(messages.leadId, lead.id));
    expect(msg).toMatchObject({ externalId: `${CHAT}:777`, source: "bot" });
    expect(msg.text).toContain("Запрос: Нужно вести соцсети");

    expect(lastSent().text).toBe(`Заявка №${lead.id} принята! Менеджер свяжется с вами в ближайшее время.`);
    // диалог завершён — шаг сброшен
    expect((await db.select().from(botSessions))[0].step).toBe("idle");
  });

  it("answers every callback query", async () => {
    await bot.handleUpdate(command("/start"));
    await bot.handleUpdate(callback("svc:site"));
    expect(calls.filter((c) => c.method === "answerCallbackQuery")).toHaveLength(1);
  });

  it("persists the dialog step between updates in bot_sessions", async () => {
    await bot.handleUpdate(command("/start"));
    await bot.handleUpdate(callback("svc:ads"));
    const [row] = await db.select().from(botSessions);
    expect(row).toMatchObject({ chatId: CHAT, step: "name", data: { service: "Реклама" } });
  });

  it("renders keyboards for grammY: request_contact, remove and inline", async () => {
    await bot.handleUpdate(command("/start"));
    expect(lastSent().reply_markup.inline_keyboard[0].map((b) => b.text)).toEqual(["Сайт", "Реклама", "SMM", "Другое"]);
    await bot.handleUpdate(callback("svc:site"));
    expect(lastSent().reply_markup.keyboard).toEqual([[{ text: "Иван Петров" }]]);
    await bot.handleUpdate(text("Иван"));
    expect(lastSent().reply_markup.keyboard[0][0]).toEqual({ text: "📱 Поделиться номером", request_contact: true });
    expect(lastSent().reply_markup.keyboard[1][0]).toEqual({ text: "✈️ Пишите сюда, в Telegram" });
    await bot.handleUpdate(text("@ivan_p"));
    expect(lastSent().reply_markup).toEqual({ remove_keyboard: true });
  });

  it("a double click on «Отправить» and a redelivered update produce a single lead", async () => {
    await fillDialog();
    const submit = callback("submit:1", 777);
    await bot.handleUpdate(submit);
    await bot.handleUpdate(submit);
    expect(await db.select().from(leads)).toHaveLength(1);
    expect(await db.select().from(messages)).toHaveLength(1);
  });

  it("the same person writing again later is merged into the same lead", async () => {
    await fillDialog();
    await bot.handleUpdate(callback("submit:1", 777));
    await fillDialog();
    await bot.handleUpdate(callback("submit:2", 888));
    expect(await db.select().from(leads)).toHaveLength(1);
    expect(await db.select().from(messages)).toHaveLength(2);
  });

  it("a stale callback gets an answer with text and does not touch state", async () => {
    await bot.handleUpdate(callback("submit"));
    const answer = calls.find((c) => c.method === "answerCallbackQuery");
    expect(answer?.payload.text).toBe("Эта кнопка уже неактуальна");
    expect(sent()).toHaveLength(0);
    expect(await db.select().from(leads)).toHaveLength(0);
  });

  it("/cancel resets the dialog", async () => {
    await bot.handleUpdate(command("/start"));
    await bot.handleUpdate(callback("svc:site"));
    await bot.handleUpdate(command("/cancel"));
    expect((await db.select().from(botSessions))[0].step).toBe("idle");
    expect(lastSent().text).toContain("отменена");
  });

  it("non-text input (sticker) gets a hint", async () => {
    await bot.handleUpdate(command("/start"));
    await bot.handleUpdate(callback("svc:site"));
    await bot.handleUpdate(message({ sticker: { file_id: "x", file_unique_id: "y", type: "regular", width: 1, height: 1, is_animated: false, is_video: false } }));
    expect(lastSent().text).toContain("текстом");
    const [row] = await db.select().from(botSessions);
    expect(row.step).toBe("name");
  });

  it("an unknown command is not taken as an answer", async () => {
    await bot.handleUpdate(command("/start"));
    await bot.handleUpdate(callback("svc:site"));
    await bot.handleUpdate(command("/help"));
    const [row] = await db.select().from(botSessions);
    expect(row.step).toBe("name");
  });

  it("ignores group chats", async () => {
    await bot.handleUpdate({
      update_id: 99,
      message: { message_id: 1, date: 0, chat: { id: -100, type: "group", title: "g" }, from: USER, text: "/start", entities: [{ type: "bot_command", offset: 0, length: 6 }] },
    } as Update);
    expect(calls).toHaveLength(0);
  });

  describe("drafts and concurrency", () => {
    it("«Отправить» under an old draft's message is stale and does not swallow the new application", async () => {
      await fillDialog();
      await bot.handleUpdate(callback("submit:1", 777));
      await fillDialog();
      // нажатие под СТАРЫМ сообщением (message_id 777) при новом черновике на шаге подтверждения
      await bot.handleUpdate(callback("submit:1", 777));
      expect(calls.filter((c) => c.method === "answerCallbackQuery").at(-1)?.payload).toMatchObject({
        text: "Эта кнопка уже неактуальна",
      });
      expect((await db.select().from(botSessions))[0].step).toBe("confirm");
      expect(await db.select().from(messages)).toHaveLength(1);

      await bot.handleUpdate(callback("submit:2", 888));
      expect(await db.select().from(messages)).toHaveLength(2);
      expect(lastSent().text).toContain("принята");
    });

    it("removes the inline keyboard from the message whose button was handled, but not for stale buttons", async () => {
      await fillDialog();
      const edits = () => calls.filter((c) => c.method === "editMessageReplyMarkup");
      const before = edits().length; // выбор услуги в fillDialog тоже убирает кнопки
      await bot.handleUpdate(callback("submit:1", 777));
      expect(edits()).toHaveLength(before + 1);
      expect(edits().at(-1)?.payload).toMatchObject({ message_id: 777, reply_markup: { inline_keyboard: [] } });

      await bot.handleUpdate(callback("submit:1", 777)); // уже устарела
      expect(edits()).toHaveLength(before + 1);
    });

    it("the session upsert is monotonic: a late update does not roll last_update_id back", async () => {
      await bot.handleUpdate(command("/start"));
      const [{ lastUpdateId }] = await db.select().from(botSessions);
      // имитируем запоздавший параллельный апдейт, который прочитал старую сессию
      await db.execute(sql`update bot_sessions set last_update_id = ${lastUpdateId + 50}`);
      const late = callback("svc:site");
      Object.assign(late, { update_id: lastUpdateId + 10 });
      await bot.handleUpdate(late); // пропущен как «уже обработанный»
      const [row] = await db.select().from(botSessions);
      expect(row.lastUpdateId).toBe(lastUpdateId + 50);
      expect(row.step).toBe("service");
    });
  });

  describe("update_id renumbering after a long silence", () => {
    it("a stale session row (older than 24h) does not block an update with a smaller update_id", async () => {
      await bot.handleUpdate(command("/start"));
      await db.execute(sql`update bot_sessions set last_update_id = 9000000, updated_at = now() - interval '2 days'`);
      const before = sent().length;

      const next = command("/start");
      Object.assign(next, { update_id: 42 });
      await bot.handleUpdate(next);

      expect(sent().length).toBe(before + 1);
      const [row] = await db.select().from(botSessions);
      expect(row).toMatchObject({ step: "service", lastUpdateId: 42 });
    });

    it("a fresh row still filters retries with a smaller update_id", async () => {
      await bot.handleUpdate(command("/start"));
      await db.execute(sql`update bot_sessions set last_update_id = 9000000`);
      const before = sent().length;
      const old = command("/start");
      Object.assign(old, { update_id: 42 });
      await bot.handleUpdate(old);
      expect(sent().length).toBe(before);
    });
  });

  describe("retries and idempotency", () => {
    it("a redelivered update does not move the dialog or send anything twice", async () => {
      await bot.handleUpdate(command("/start"));
      const pick = callback("svc:smm");
      await bot.handleUpdate(pick);
      const before = calls.length;
      const [row] = await db.select().from(botSessions);
      expect(row.lastUpdateId).toBe(pick.update_id);

      await bot.handleUpdate(pick);
      expect(calls.length).toBe(before);
      expect((await db.select().from(botSessions))[0]).toMatchObject({ step: "name", data: { service: "SMM" } });
    });

    it("an older update_id is ignored too", async () => {
      await bot.handleUpdate(command("/start"));
      const stale = text("Иван"); // update_id выдан раньше следующего
      await bot.handleUpdate(callback("svc:smm"));
      await bot.handleUpdate(stale);
      expect((await db.select().from(botSessions))[0].step).toBe("name");
    });

    it("a redelivered submit creates a single lead", async () => {
      await fillDialog();
      const submit = callback("submit:1", 777);
      await bot.handleUpdate(submit);
      const before = calls.length;
      await bot.handleUpdate(submit);
      expect(calls.length).toBe(before);
      expect(await db.select().from(leads)).toHaveLength(1);
    });

    it("a failure before the commit is thrown (-> 500) and the retry of the same update succeeds", async () => {
      await fillDialog();
      const submit = callback("submit:1", 777);
      await db.execute(sql`alter table leads rename to leads_broken`);
      await expect(bot.handleUpdate(submit)).rejects.toThrow();
      expect((await db.select().from(botSessions))[0].step).toBe("confirm");
      expect(sent().at(-1)?.text).not.toContain("принята");

      await db.execute(sql`alter table leads_broken rename to leads`);
      await bot.handleUpdate(submit);
      expect(await db.select().from(leads)).toHaveLength(1);
      expect(lastSent().text).toContain("принята");
      expect((await db.select().from(botSessions))[0].step).toBe("idle");
    });

    it("a failure to send replies is only logged: the state is already committed", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      bot.api.config.use(async (prev, method, payload, signal) => {
        if (method === "sendMessage") throw new Error("Bot API down");
        return prev(method, payload, signal);
      });
      await expect(bot.handleUpdate(command("/start"))).resolves.toBeUndefined();
      expect((await db.select().from(botSessions))[0].step).toBe("service");
      spy.mockRestore();
    });
  });

  describe("notification subscription", () => {
    it("a valid token subscribes the chat (once), an invalid one just starts the dialog", async () => {
      const token = getNotifySubscribeUrl().split("start=")[1];
      await bot.handleUpdate(command(`/start ${token}`));
      expect(await db.select().from(notifySubscribers)).toEqual([expect.objectContaining({ chatId: CHAT })]);
      expect(lastSent().text).toContain("буду присылать уведомления");
      await bot.handleUpdate(command(`/start ${token}`));
      expect(await db.select().from(notifySubscribers)).toHaveLength(1);

      await db.delete(notifySubscribers);
      await bot.handleUpdate(command("/start notify_deadbeef"));
      expect(await db.select().from(notifySubscribers)).toHaveLength(0);
      expect(lastSent().text).toContain("Здравствуйте");
    });
  });
});
