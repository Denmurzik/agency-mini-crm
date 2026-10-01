import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage, type NewMessageEvent } from "telegram/events/index.js";
import { computeCheck } from "telegram/Password.js";
import { LogLevel, Logger as GramLogger } from "telegram/extensions/Logger.js";
import type { IncomingMessage, MediaKind } from "./filter.js";
import { errText, type Logger } from "./log.js";
import { createSenderResolver } from "./sender.js";

export type TgUser = {
  id: number;
  phone: string | null;
  username: string | null;
  displayName: string;
};

export type SignInResult = { kind: "ok"; user: TgUser } | { kind: "password" };

/** Узкий интерфейс над GramJS: менеджер и тесты зависят только от него. */
export type TgClient = {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  sendCode(phone: string): Promise<{ phoneCodeHash: string }>;
  signIn(phone: string, phoneCodeHash: string, code: string): Promise<SignInResult>;
  checkPassword(password: string): Promise<TgUser>;
  getMe(): Promise<TgUser>;
  saveSession(): string;
  logOut(): Promise<void>;
  /** Вешает обработчик входящих личных сообщений; повторный вызов заменяет предыдущий. */
  listen(handler: (msg: IncomingMessage) => void | Promise<void>): void;
  /**
   * Догонялка: непрочитанные входящие из личных диалогов (старые сначала).
   * Заменяет catchUp() GramJS, который фактически не реализован: без неё всё, что пришло,
   * пока воркер перезапускался, потерялось бы.
   */
  fetchUnread(opts: { dialogs: number; perDialog: number; maxAgeMs: number }): Promise<IncomingMessage[]>;
};

export type TgClientFactory = (session: string) => TgClient;

const big = (v: { toString(): string } | undefined | null): number => Number(v?.toString() ?? 0);

function toUser(u: Api.TypeUser): TgUser {
  if (!(u instanceof Api.User)) throw new Error("Неожиданный тип пользователя");
  const displayName = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || u.phone || "Без имени";
  return { id: big(u.id), phone: u.phone ?? null, username: u.username ?? null, displayName };
}

type Sender = NonNullable<IncomingMessage["sender"]> & { min: boolean };

function toSender(s: Api.User): Sender {
  return {
    min: Boolean(s.min),
    id: big(s.id),
    firstName: s.firstName,
    lastName: s.lastName,
    username: s.username,
    phone: s.phone,
    isBot: Boolean(s.bot),
    isContact: Boolean(s.contact),
  };
}

function toIncoming(m: Api.Message, sender: IncomingMessage["sender"]): IncomingMessage {
  return {
    out: Boolean(m.out),
    isPrivate: Boolean(m.isPrivate),
    chatId: big(m.chatId),
    messageId: m.id,
    text: m.message ?? "",
    media: mediaKind(m),
    sender,
  };
}

function mediaKind(m: Api.Message): MediaKind | null {
  if (m.sticker) return "sticker";
  if (m.voice) return "voice";
  if (m.videoNote) return "videoNote";
  if (m.video || m.gif) return "video";
  if (m.photo) return "photo";
  if (m.document || m.audio) return "file";
  // Прочее (геолокация, контакт, опрос) — тоже «не текст»
  return m.media ? "file" : null;
}

export function createGramClientFactory(apiId: number, apiHash: string, log: Logger): TgClientFactory {
  return (sessionString) => {
    const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
      connectionRetries: 5,
      // Свои логи пишем сами; GramJS шумит на info.
      baseLogger: new GramLogger(LogLevel.ERROR),
    });
    const senders = createSenderResolver<Sender>();
    let handlerBuilder: NewMessage | null = null;
    let handlerFn: ((e: NewMessageEvent) => Promise<void>) | null = null;

    return {
      connect: () => client.connect().then(() => undefined),
      disconnect: () => client.disconnect(),
      isConnected: () => Boolean(client.connected),

      async sendCode(phone) {
        const { phoneCodeHash } = await client.sendCode({ apiId, apiHash }, phone);
        return { phoneCodeHash };
      },

      async signIn(phone, phoneCodeHash, code) {
        try {
          const res = await client.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code }));
          if (res instanceof Api.auth.AuthorizationSignUpRequired) {
            throw Object.assign(new Error("PHONE_NOT_REGISTERED"), { errorMessage: "PHONE_NOT_REGISTERED" });
          }
          return { kind: "ok", user: toUser(res.user) };
        } catch (err) {
          if ((err as { errorMessage?: string }).errorMessage === "SESSION_PASSWORD_NEEDED") return { kind: "password" };
          throw err;
        }
      },

      async checkPassword(password) {
        const pwd = await client.invoke(new Api.account.GetPassword());
        const check = await computeCheck(pwd, password);
        const res = await client.invoke(new Api.auth.CheckPassword({ password: check }));
        if (!(res instanceof Api.auth.Authorization)) throw new Error("Неожиданный ответ Telegram");
        return toUser(res.user);
      },

      async getMe() {
        return toUser(await client.getMe());
      },

      saveSession: () => (client.session as StringSession).save(),

      async logOut() {
        await client.invoke(new Api.auth.LogOut());
      },

      async fetchUnread({ dialogs, perDialog, maxAgeMs }) {
        const minDate = Math.floor((Date.now() - maxAgeMs) / 1000);
        const result: IncomingMessage[] = [];
        for (const d of await client.getDialogs({ limit: dialogs })) {
          if (!d.isUser || !d.unreadCount || !(d.entity instanceof Api.User)) continue;
          // unreadCount считает только входящие, но среди последних сообщений могут быть и наши ответы.
          const msgs = await client.getMessages(d.entity, { limit: Math.min(d.unreadCount, perDialog) });
          const sender = toSender(d.entity);
          for (const m of [...msgs].reverse()) {
            if (!m.out && m.date >= minDate) result.push(toIncoming(m, sender));
          }
        }
        return result;
      },

      listen(handler) {
        if (handlerFn && handlerBuilder) client.removeEventHandler(handlerFn, handlerBuilder);
        handlerBuilder = new NewMessage({ incoming: true });
        handlerFn = async (event) => {
          try {
            const m = event.message;
            // Группы и каналы отсекаем до сетевых запросов за сущностью отправителя.
            let sender: IncomingMessage["sender"] = null;
            if (m.isPrivate && !m.out) {
              const s = await m.getSender();
              if (s instanceof Api.User) {
                sender = await senders.resolve(toSender(s), async () => {
                  const input = await client.getInputEntity(s);
                  if (!(input instanceof Api.InputPeerUser)) return null;
                  const [full] = await client.invoke(
                    new Api.users.GetUsers({ id: [new Api.InputUser({ userId: input.userId, accessHash: input.accessHash })] }),
                  );
                  return full instanceof Api.User ? toSender(full) : null;
                });
              }
            }
            await handler(toIncoming(m, sender));
          } catch (err) {
            log.error("Ошибка обработки входящего сообщения", { reason: errText(err) });
          }
        };
        client.addEventHandler(handlerFn, handlerBuilder);
      },
    };
  };
}
