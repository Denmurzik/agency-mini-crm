import { describe, expect, it } from "vitest";
import {
  buildIngestPayload,
  messageText,
  senderContact,
  senderName,
  shouldIngest,
  type IncomingMessage,
  type SenderInfo,
} from "../src/filter.js";

const SELF = 100;

const sender = (over: Partial<SenderInfo> = {}): SenderInfo => ({
  id: 555,
  firstName: "Иван",
  lastName: "Петров",
  username: "ivan",
  phone: null,
  isBot: false,
  isContact: false,
  ...over,
});

const msg = (over: Partial<IncomingMessage> = {}): IncomingMessage => ({
  out: false,
  isPrivate: true,
  chatId: 555,
  messageId: 7,
  text: "Нужен сайт",
  media: null,
  sender: sender(),
  ...over,
});

describe("shouldIngest", () => {
  it("пропускает входящее личное сообщение от незнакомого человека", () => {
    expect(shouldIngest(msg(), SELF)).toBe(true);
  });
  it("отбрасывает исходящие", () => {
    expect(shouldIngest(msg({ out: true }), SELF)).toBe(false);
  });
  it("отбрасывает группы и каналы", () => {
    expect(shouldIngest(msg({ isPrivate: false }), SELF)).toBe(false);
  });
  it("отбрасывает сообщения без определённого отправителя", () => {
    expect(shouldIngest(msg({ sender: null }), SELF)).toBe(false);
  });
  it("отбрасывает ботов", () => {
    expect(shouldIngest(msg({ sender: sender({ isBot: true }) }), SELF)).toBe(false);
  });
  it("отбрасывает самого себя", () => {
    expect(shouldIngest(msg({ sender: sender({ id: SELF }) }), SELF)).toBe(false);
  });
  it("отбрасывает служебный аккаунт Telegram 777000", () => {
    expect(shouldIngest(msg({ sender: sender({ id: 777000 }) }), SELF)).toBe(false);
  });
  it("отбрасывает контакты из адресной книги", () => {
    expect(shouldIngest(msg({ sender: sender({ isContact: true }) }), SELF)).toBe(false);
  });
});

describe("senderName", () => {
  it("имя и фамилия", () => expect(senderName({ firstName: "Иван", lastName: "Петров" })).toBe("Иван Петров"));
  it("только имя", () => expect(senderName({ firstName: "Иван", lastName: null })).toBe("Иван"));
  it("username, если нет имени", () => expect(senderName({ firstName: "", username: "ivan" })).toBe("ivan"));
  it("«Без имени» как запасной вариант", () => expect(senderName({})).toBe("Без имени"));
  it("пробельное имя считается пустым", () => expect(senderName({ firstName: "  ", username: "u" })).toBe("u"));
});

describe("senderContact", () => {
  it("@username в приоритете", () => expect(senderContact({ username: "ivan", phone: "79991112233" })).toBe("@ivan"));
  it("телефон с плюсом", () => expect(senderContact({ username: null, phone: "79991112233" })).toBe("+79991112233"));
  it("null, если ничего нет", () => expect(senderContact({ username: null, phone: null })).toBeNull());
});

describe("messageText", () => {
  it("возвращает текст без лишних пробелов", () => expect(messageText("  привет ", null)).toBe("привет"));
  it("подпись к медиа важнее плейсхолдера", () => expect(messageText("смотрите", "photo")).toBe("смотрите"));
  it.each([
    ["photo", "[фото]"],
    ["voice", "[голосовое сообщение]"],
    ["video", "[видео]"],
    ["videoNote", "[видеосообщение]"],
    ["file", "[файл]"],
    ["sticker", "[стикер]"],
  ] as const)("плейсхолдер для %s", (kind, expected) => expect(messageText("", kind)).toBe(expected));
  it("без текста и без медиа", () => expect(messageText("   ", null)).toBe("[сообщение без текста]"));
  it("обрезает слишком длинный текст", () => expect(messageText("а".repeat(5000), null)).toHaveLength(4000));
});

describe("buildIngestPayload", () => {
  it("собирает тело по контракту /api/ingest", () => {
    expect(buildIngestPayload(msg(), SELF)).toEqual({
      source: "telegram",
      name: "Иван Петров",
      contact: "@ivan",
      request: "Нужен сайт",
      tgUserId: 555,
      tgUsername: "ivan",
      message: { text: "Нужен сайт", externalId: "100:555:7" },
    });
  });
  it("не-текст превращается в плейсхолдер, username отсутствует", () => {
    const p = buildIngestPayload(
      msg({ text: "", media: "voice", sender: sender({ username: null, phone: "79990001122", lastName: null }) }),
      SELF,
    );
    expect(p).toMatchObject({
      name: "Иван",
      contact: "+79990001122",
      tgUsername: null,
      request: "[голосовое сообщение]",
      message: { text: "[голосовое сообщение]" },
    });
  });
  it("бросает ошибку без отправителя", () => {
    expect(() => buildIngestPayload(msg({ sender: null }), SELF)).toThrow();
  });
});
