import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const leadSource = pgEnum("lead_source", ["bot", "telegram", "manual"]);
export const leadStatus = pgEnum("lead_status", ["new", "in_progress", "won", "lost"]);
export const tgAccountStatus = pgEnum("tg_account_status", ["connected", "disconnected", "error"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const leads = pgTable(
  "leads",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    contact: text("contact"),
    request: text("request"),
    source: leadSource("source").notNull(),
    status: leadStatus("status").notNull().default("new"),
    // Ключ дедупа: один человек в Telegram = одна карточка, откуда бы он ни писал.
    tgUserId: bigint("tg_user_id", { mode: "number" }),
    tgUsername: text("tg_username"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("leads_tg_user_id_idx").on(t.tgUserId),
    index("leads_last_activity_idx").on(t.lastActivityAt),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tags_name_lower_idx").on(sql`lower(${t.name})`)],
);

export const leadTags = pgTable(
  "lead_tags",
  {
    leadId: integer("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.leadId, t.tagId] }), index("lead_tags_tag_idx").on(t.tagId)],
);

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    source: leadSource("source").notNull(),
    text: text("text").notNull(),
    // Идентификатор во внешней системе (например, `<chat_id>:<message_id>`) — защита от повторной доставки.
    externalId: text("external_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("messages_source_external_idx").on(t.source, t.externalId),
    index("messages_lead_idx").on(t.leadId),
  ],
);

export const botSessions = pgTable("bot_sessions", {
  chatId: bigint("chat_id", { mode: "number" }).primaryKey(),
  step: text("step").notNull(),
  data: jsonb("data").notNull().default({}),
  // update_id последнего обработанного апдейта: Telegram ретраит webhook, повтор не должен двигать диалог.
  lastUpdateId: bigint("last_update_id", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notifySubscribers = pgTable("notify_subscribers", {
  chatId: bigint("chat_id", { mode: "number" }).primaryKey(),
  createdAt: createdAt(),
});

export const tgAccounts = pgTable("tg_accounts", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull(),
  tgUserId: bigint("tg_user_id", { mode: "number" }),
  username: text("username"),
  displayName: text("display_name"),
  // Строка сессии GramJS, зашифрованная AES-256-GCM. Ключ есть только у воркера.
  sessionEnc: text("session_enc"),
  status: tgAccountStatus("status").notNull().default("disconnected"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type TgAccount = typeof tgAccounts.$inferSelect;
export type LeadSource = (typeof leadSource.enumValues)[number];
export type LeadStatus = (typeof leadStatus.enumValues)[number];
