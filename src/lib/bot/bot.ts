import { eq, lt, or, sql } from "drizzle-orm";
import { Bot, type Context } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { getDb, type Db } from "@/lib/db";
import { botSessions, notifySubscribers } from "@/lib/db/schema";
import { ingestLead, type IngestOptions } from "@/lib/leads/ingest";
import { ingestBusinessMessage, saveBusinessConnection } from "./business";
import {
  IDLE,
  step,
  submittedReplies,
  summary,
  type Effect,
  type FlowInput,
  type FlowState,
  type Keyboard,
  type Profile,
  type Reply,
  type Step,
} from "./flow";

const STEPS: Step[] = ["idle", "service", "name", "contact", "request", "confirm"];

export type CreateBotOptions = {
  token: string;
  db: Db;
  /** Если передан, `getMe` при старте не вызывается — нужно для тестов и холодных стартов на Vercel. */
  botInfo?: UserFromGetMe;
  /** Параметры `ingestLead` (в тестах — отключить уведомления). */
  ingestOptions?: IngestOptions;
};

// ── состояние диалога в БД ──────────────────────────────────────────────────

/**
 * Telegram хранит недоставленные апдейты сутки, поэтому и «ретрай по update_id» имеет смысл только внутри суток.
 * После долгого простоя Bot API выбирает следующий update_id случайно — он может оказаться меньше сохранённого.
 */
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

async function loadSession(
  db: Db,
  chatId: number,
): Promise<{ state: FlowState; lastUpdateId: number; updatedAt: Date | null }> {
  const [row] = await db.select().from(botSessions).where(eq(botSessions.chatId, chatId)).limit(1);
  if (!row) return { state: IDLE, lastUpdateId: 0, updatedAt: null };
  const known = STEPS.includes(row.step as Step);
  return {
    state: known ? { step: row.step as Step, data: (row.data ?? {}) as FlowState["data"] } : IDLE,
    lastUpdateId: row.lastUpdateId,
    updatedAt: row.updatedAt,
  };
}

/** Состояние и `last_update_id` пишутся одной записью. Строку для `idle` не удаляем: в ней живёт `last_update_id`. */
async function saveSession(db: Db, chatId: number, state: FlowState, updateId: number): Promise<void> {
  await db
    .insert(botSessions)
    .values({ chatId, step: state.step, data: state.data, lastUpdateId: updateId })
    .onConflictDoUpdate({
      target: botSessions.chatId,
      set: { step: state.step, data: state.data, lastUpdateId: updateId, updatedAt: new Date() },
      // Монотонно: запоздавший параллельный апдейт не откатывает last_update_id назад.
      // Строка старше суток — Telegram мог перенумеровать апдейты, перезаписываем безусловно.
      setWhere: or(
        lt(botSessions.lastUpdateId, sql`excluded.last_update_id`),
        lt(botSessions.updatedAt, sql`now() - interval '24 hours'`),
      ),
    });
}

// ── рендер абстрактных ответов ──────────────────────────────────────────────

function renderKeyboard(k: Keyboard | undefined) {
  if (!k) return undefined;
  switch (k.kind) {
    case "inline":
      return { inline_keyboard: k.rows.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) };
    case "reply":
      return {
        keyboard: k.rows.map((row) =>
          row.map((b) => (b.requestContact ? { text: b.text, request_contact: true } : { text: b.text })),
        ),
        resize_keyboard: true,
        one_time_keyboard: true,
        input_field_placeholder: k.placeholder,
      };
    case "remove":
      return { remove_keyboard: true as const };
  }
}

async function sendReplies(ctx: Context, replies: Reply[]): Promise<void> {
  for (const r of replies) {
    await ctx.reply(r.text, { reply_markup: renderKeyboard(r.keyboard) });
  }
}

// ── обработка входа ─────────────────────────────────────────────────────────

function profileOf(ctx: Context): Profile {
  const from = ctx.from;
  return { firstName: from?.first_name ?? "", lastName: from?.last_name ?? null, username: from?.username ?? null };
}

export function createBot({ token, db, botInfo, ingestOptions }: CreateBotOptions): Bot {
  const bot = new Bot(token, botInfo ? { botInfo } : undefined);

  /**
   * Порядок важен для ретраев Telegram: эффект (идемпотентный: лид дедуплицируется по externalId,
   * подписка — on conflict) → запись состояния с `last_update_id` → отправка ответов.
   * Падение до записи состояния пробрасывается наружу (webhook ответит 500, Telegram повторит апдейт),
   * падение отправки ответа — только логируется: всё уже зафиксировано.
   */
  async function handle(ctx: Context, input: FlowInput): Promise<void> {
    const chatId = ctx.chat?.id;
    if (chatId == null || !ctx.from) return;
    const updateId = ctx.update.update_id;

    const { state, lastUpdateId, updatedAt } = await loadSession(db, chatId);
    const fresh = updatedAt != null && Date.now() - updatedAt.getTime() < RETRY_WINDOW_MS;
    if (fresh && updateId <= lastUpdateId) return; // ретрай уже обработанного апдейта

    const result = step(state, input, profileOf(ctx));

    // «Часики» на кнопке гасим всегда; текст в ответе — только для устаревших кнопок.
    if (input.type === "callback") {
      try {
        await ctx.answerCallbackQuery(result.callbackAnswer ? { text: result.callbackAnswer } : undefined);
      } catch (err) {
        console.warn("[bot] answerCallbackQuery failed", err);
      }
    }

    const replies = result.effect ? await runEffect(result.effect, ctx, result.replies) : result.replies;
    await saveSession(db, chatId, result.state, updateId);

    // Нажатая кнопка своё отработала: убираем клавиатуру, чтобы старое сообщение не вводило в заблуждение.
    if (input.type === "callback" && !result.callbackAnswer) {
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
      } catch (err) {
        console.warn("[bot] editMessageReplyMarkup failed", err);
      }
    }

    try {
      await sendReplies(ctx, replies);
    } catch (err) {
      console.error("[bot] failed to send replies", err);
    }
  }

  async function runEffect(effect: Effect, ctx: Context, replies: Reply[]): Promise<Reply[]> {
    const chatId = ctx.chat!.id;
    if (effect.type === "subscribe") {
      await db.insert(notifySubscribers).values({ chatId }).onConflictDoNothing();
      return replies;
    }

    const { draft } = effect;
    // id сообщения с кнопкой — стабильный ключ: двойной клик и повторная доставка дают один лид.
    const messageId = ctx.callbackQuery?.message?.message_id ?? ctx.update.update_id;
    const { lead } = await ingestLead(
      db,
      {
        source: "bot",
        name: draft.name,
        contact: draft.contact,
        request: draft.request,
        tgUserId: ctx.from!.id,
        tgUsername: ctx.from!.username ?? null,
        tags: [draft.service],
        message: { text: summary(draft), externalId: `${chatId}:${messageId}` },
      },
      ingestOptions,
    );
    return submittedReplies(lead.id);
  }

  // Telegram Business: только запись в БД, никаких ответов (они ушли бы от имени владельца аккаунта).
  // Регистрируем до диалоговых обработчиков и не зовём next().
  bot.on("business_connection", (ctx) => saveBusinessConnection(db, ctx.businessConnection));
  bot.on("business_message", (ctx) => ingestBusinessMessage(db, ctx.businessMessage, ctx.api, ingestOptions));

  // Бот работает только в личке.
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type === "private") await next();
  });

  bot.command("start", (ctx) => handle(ctx, { type: "start", payload: ctx.match }));
  bot.command("cancel", (ctx) => handle(ctx, { type: "cancel" }));
  bot.on("callback_query:data", (ctx) => handle(ctx, { type: "callback", data: ctx.callbackQuery.data }));
  bot.on("message:contact", (ctx) => {
    const c = ctx.message.contact;
    return handle(ctx, { type: "contact", phone: c.phone_number, own: c.user_id === ctx.from.id });
  });
  bot.on("message:text", (ctx) => {
    // Неизвестная команда — не ответ на вопрос диалога.
    const isCommand = ctx.message.entities?.some((e) => e.type === "bot_command" && e.offset === 0);
    return handle(ctx, isCommand ? { type: "other" } : { type: "text", text: ctx.message.text });
  });
  bot.on("message", (ctx) => handle(ctx, { type: "other" }));

  return bot;
}

/** `getMe` без похода в сеть: id бота — это префикс токена. */
export function buildBotInfo(token: string, username: string): UserFromGetMe {
  return {
    id: Number(token.split(":")[0]),
    is_bot: true,
    first_name: username,
    username,
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
  };
}

// ── синглтон для рантайма ───────────────────────────────────────────────────

let cached: Bot | null | undefined;

/** Ленивый синглтон: `null`, если токен бота не задан. */
export function getBot(): Bot | null {
  if (cached === undefined) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      cached = null;
    } else {
      const username = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
      // Собираем botInfo из токена и username — на холодном старте не нужен лишний getMe.
      const botInfo = username ? buildBotInfo(token, username) : undefined;
      cached = createBot({ token, db: getDb(), botInfo });
    }
  }
  return cached;
}

/** Обрабатывает апдейт от Telegram. Бот не настроен — no-op. */
export async function handleUpdate(update: Update): Promise<void> {
  const bot = getBot();
  if (!bot) return;
  if (!bot.isInited()) await bot.init();
  await bot.handleUpdate(update);
}
