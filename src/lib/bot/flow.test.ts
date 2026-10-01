import { describe, expect, it } from "vitest";
import {
  BTN_SHARE_PHONE,
  BTN_TG_CONTACT,
  IDLE,
  STALE_BUTTON,
  parseContact,
  step,
  submittedReplies,
  summary,
  type FlowInput,
  type FlowState,
  type Keyboard,
  type Profile,
  type StepResult,
} from "./flow";

const profile: Profile = { firstName: "Иван", lastName: "Петров", username: "ivan_p" };
const noUsername: Profile = { firstName: "Мария" };
const deps = { verifyToken: (t: string) => t === "good" };

const run = (state: FlowState, input: FlowInput, p: Profile = profile) => step(state, input, p, deps);

/** Прогоняет входы подряд, возвращает финальный результат. */
function walk(inputs: FlowInput[], p: Profile = profile): StepResult {
  let state: FlowState = IDLE;
  let last!: StepResult;
  for (const input of inputs) {
    last = run(state, input, p);
    state = last.state;
  }
  return last;
}

const texts = (r: StepResult) => r.replies.map((x) => x.text).join("\n");
const kb = (r: StepResult): Keyboard | undefined => r.replies.at(-1)?.keyboard;
const inlineData = (k: Keyboard | undefined) => (k?.kind === "inline" ? k.rows.flat().map((b) => b.data) : []);
const replyTexts = (k: Keyboard | undefined) => (k?.kind === "reply" ? k.rows.flat().map((b) => b.text) : []);

const toService: FlowInput[] = [{ type: "start" }];
const toName: FlowInput[] = [...toService, { type: "callback", data: "svc:site" }];
const toContact: FlowInput[] = [...toName, { type: "text", text: "Иван" }];
const toRequest: FlowInput[] = [...toContact, { type: "text", text: "+7 (999) 123-45-67" }];
const toConfirm: FlowInput[] = [...toRequest, { type: "text", text: "Нужен лендинг для кофейни" }];

describe("flow: happy path", () => {
  it("start greets and offers all services as inline buttons", () => {
    const r = walk(toService);
    expect(r.state.step).toBe("service");
    expect(texts(r)).toContain("Здравствуйте! Помогу оставить заявку в агентство — это займёт минуту.");
    expect(inlineData(kb(r))).toEqual(["svc:site", "svc:ads", "svc:smm", "svc:other"]);
    expect(r.effect).toBeUndefined();
  });

  it("choosing a service stores it as a tag and asks for the name with the profile name button", () => {
    const r = walk(toName);
    expect(r.state).toEqual({ step: "name", data: { service: "Сайт" } });
    expect(replyTexts(kb(r))).toEqual(["Иван Петров"]);
  });

  it("name moves to contact with share-phone and username buttons", () => {
    const r = walk(toContact);
    expect(r.state.step).toBe("contact");
    expect(r.state.data.name).toBe("Иван");
    expect(replyTexts(kb(r))).toEqual([BTN_SHARE_PHONE, BTN_TG_CONTACT]);
    const k = kb(r);
    expect(k?.kind === "reply" && k.rows[0][0].requestContact).toBe(true);
  });

  it("omits the username button when the user has no username", () => {
    const r = walk(toContact, noUsername);
    expect(replyTexts(kb(r))).toEqual([BTN_SHARE_PHONE]);
  });

  it("contact moves to request and removes the keyboard", () => {
    const r = walk(toRequest);
    expect(r.state.step).toBe("request");
    expect(r.state.data.contact).toBe("+79991234567");
    expect(kb(r)).toEqual({ kind: "remove" });
  });

  it("request shows the summary, consent line and confirm buttons", () => {
    const r = walk(toConfirm);
    expect(r.state.step).toBe("confirm");
    const t = texts(r);
    expect(t).toContain("Услуга: Сайт");
    expect(t).toContain("Имя: Иван");
    expect(t).toContain("Контакт: +79991234567");
    expect(t).toContain("Запрос: Нужен лендинг для кофейни");
    expect(t).toContain("Нажимая «Отправить», вы соглашаетесь на обработку персональных данных.");
    expect(inlineData(kb(r))).toEqual(["submit", "restart"]);
  });

  it("submit emits the submit effect and resets the state", () => {
    const r = walk([...toConfirm, { type: "callback", data: "submit" }]);
    expect(r.state).toEqual(IDLE);
    expect(r.effect).toEqual({
      type: "submit",
      draft: { service: "Сайт", name: "Иван", contact: "+79991234567", request: "Нужен лендинг для кофейни" },
    });
  });

  it("restart goes back to service selection with empty data", () => {
    const r = walk([...toConfirm, { type: "callback", data: "restart" }]);
    expect(r.state).toEqual({ step: "service", data: {} });
    expect(inlineData(kb(r))).toContain("svc:smm");
  });

  it("each service maps to its tag", () => {
    for (const [key, tag] of [
      ["ads", "Реклама"],
      ["smm", "SMM"],
      ["other", "Другое"],
    ]) {
      const r = walk([...toService, { type: "callback", data: `svc:${key}` }]);
      expect(r.state.data.service).toBe(tag);
    }
  });

  it("builds the after-submit replies", () => {
    expect(submittedReplies(42)[0].text).toBe("Заявка №42 принята! Менеджер свяжется с вами в ближайшее время.");
  });

  it("summary lists all draft fields", () => {
    expect(summary({ service: "SMM", name: "А", contact: "@abcde", request: "Пост" })).toBe(
      "Ваша заявка:\n• Услуга: SMM\n• Имя: А\n• Контакт: @abcde\n• Запрос: Пост",
    );
  });
});

describe("flow: name step", () => {
  const atName = (): FlowState => walk(toName).state;

  it("accepts the profile-name button (plain text) and a custom name", () => {
    expect(run(atName(), { type: "text", text: "Иван Петров" }).state.data.name).toBe("Иван Петров");
    expect(run(atName(), { type: "text", text: "  Анна   Мария  " }).state.data.name).toBe("Анна Мария");
  });

  it("rejects too short and too long names and stays on the step", () => {
    for (const text of ["А", "   ", "я".repeat(101)]) {
      const r = run(atName(), { type: "text", text });
      expect(r.state.step).toBe("name");
      expect(texts(r)).toContain("от 2 до 100");
    }
  });

  it("accepts boundary lengths 2 and 100", () => {
    expect(run(atName(), { type: "text", text: "Ян" }).state.step).toBe("contact");
    expect(run(atName(), { type: "text", text: "я".repeat(100) }).state.step).toBe("contact");
  });

  it("hints on non-text input without changing state", () => {
    const state = atName();
    const r = run(state, { type: "other" });
    expect(r.state).toEqual(state);
    expect(texts(r)).toContain("имя");
  });

  it("does not show a name button when the profile name is too short", () => {
    const r = walk(toName, { firstName: "Я" });
    expect(kb(r)).toEqual({ kind: "remove" });
  });
});

describe("flow: contact step", () => {
  const atContact = (p: Profile = profile): FlowState => walk(toContact, p).state;

  it("accepts the shared own contact and normalizes the number", () => {
    const r = run(atContact(), { type: "contact", phone: "79991234567", own: true });
    expect(r.state).toMatchObject({ step: "request", data: { contact: "+79991234567" } });
  });

  it("rejects someone else's contact", () => {
    const r = run(atContact(), { type: "contact", phone: "79990000000", own: false });
    expect(r.state.step).toBe("contact");
    expect(texts(r)).toContain("чужой");
  });

  it("the 'write here' button takes the @username", () => {
    const r = run(atContact(), { type: "text", text: BTN_TG_CONTACT });
    expect(r.state.data.contact).toBe("@ivan_p");
    expect(r.state.step).toBe("request");
  });

  it("the 'write here' text without a username asks for a phone or email", () => {
    const r = run(atContact(noUsername), { type: "text", text: BTN_TG_CONTACT }, noUsername);
    expect(r.state.step).toBe("contact");
    expect(texts(r)).toContain("username");
  });

  it.each([
    ["+7 999 123-45-67", "+79991234567"],
    ["89991234567", "89991234567"],
    ["name@mail.ru", "name@mail.ru"],
    ["@ivan_petrov", "@ivan_petrov"],
  ])("accepts %s", (text, expected) => {
    const r = run(atContact(), { type: "text", text });
    expect(r.state.step).toBe("request");
    expect(r.state.data.contact).toBe(expected);
  });

  it.each(["привет", "12345", "name@", "@ab", "ivan_petrov", "++++", "1".repeat(20)])("rejects garbage %j and re-asks with a hint", (text) => {
    const r = run(atContact(), { type: "text", text });
    expect(r.state.step).toBe("contact");
    expect(texts(r)).toContain("Не похоже на контакт");
    expect(replyTexts(kb(r))).toContain(BTN_SHARE_PHONE);
  });

  it("hints on non-text input", () => {
    const r = run(atContact(), { type: "other" });
    expect(r.state.step).toBe("contact");
    expect(texts(r)).toContain("Поделитесь номером");
  });

  it("parseContact handles formats", () => {
    expect(parseContact("+1 (202) 555-0100")).toBe("+12025550100");
    expect(parseContact("a@b.co")).toBe("a@b.co");
    expect(parseContact("nope")).toBeNull();
  });
});

describe("flow: request step", () => {
  const atRequest = (): FlowState => walk(toRequest).state;

  it("rejects too short text", () => {
    const r = run(atRequest(), { type: "text", text: "ок" });
    expect(r.state.step).toBe("request");
    expect(texts(r)).toContain("подробнее");
  });

  it("rejects too long text", () => {
    const r = run(atRequest(), { type: "text", text: "я".repeat(2001) });
    expect(r.state.step).toBe("request");
    expect(texts(r)).toContain("2000");
  });

  it("accepts boundary lengths 3 and 2000", () => {
    expect(run(atRequest(), { type: "text", text: "abc" }).state.step).toBe("confirm");
    expect(run(atRequest(), { type: "text", text: "я".repeat(2000) }).state.step).toBe("confirm");
  });

  it("hints on stickers, photos and voice", () => {
    const state = atRequest();
    const r = run(state, { type: "other" });
    expect(r.state).toEqual(state);
    expect(texts(r)).toContain("текстом");
  });

  it("a shared contact on the request step is treated as non-text", () => {
    const state = atRequest();
    const r = run(state, { type: "contact", phone: "7999", own: true });
    expect(r.state).toEqual(state);
  });
});

describe("flow: confirm step", () => {
  const atConfirm = (): FlowState => walk(toConfirm).state;

  it("re-shows the confirmation on free text and on non-text", () => {
    for (const input of [{ type: "text", text: "а можно?" }, { type: "other" }] as FlowInput[]) {
      const r = run(atConfirm(), input);
      expect(r.state).toEqual(atConfirm());
      expect(inlineData(kb(r))).toEqual(["submit", "restart"]);
      expect(texts(r)).toContain("Нужен лендинг для кофейни");
    }
  });
});

describe("flow: edges", () => {
  it("/cancel resets from any step and removes the keyboard", () => {
    for (const inputs of [toService, toName, toContact, toRequest, toConfirm]) {
      const r = walk([...inputs, { type: "cancel" }]);
      expect(r.state).toEqual(IDLE);
      expect(kb(r)).toEqual({ kind: "remove" });
      expect(texts(r)).toContain("отменена");
      expect(r.effect).toBeUndefined();
    }
  });

  it("/cancel at idle is harmless", () => {
    expect(run(IDLE, { type: "cancel" }).state).toEqual(IDLE);
  });

  it("repeated /start mid-dialog starts over and drops collected data", () => {
    for (const inputs of [toName, toContact, toRequest, toConfirm]) {
      const r = walk([...inputs, { type: "start" }]);
      expect(r.state).toEqual({ step: "service", data: {} });
      expect(inlineData(kb(r))).toContain("svc:site");
    }
  });

  it("text at idle suggests /start", () => {
    const r = run(IDLE, { type: "text", text: "привет" });
    expect(r.state).toEqual(IDLE);
    expect(texts(r)).toContain("/start");
  });

  it("non-text at idle suggests /start", () => {
    expect(texts(run(IDLE, { type: "other" }))).toContain("/start");
  });

  it("text at the service step asks to use the buttons and keeps them", () => {
    const state = walk(toService).state;
    const r = run(state, { type: "text", text: "сайт" });
    expect(r.state).toEqual(state);
    expect(inlineData(kb(r))).toContain("svc:site");
  });

  it("stale callbacks are answered and change nothing", () => {
    const cases: [FlowState, string][] = [
      [IDLE, "svc:site"],
      [IDLE, "submit"],
      [walk(toName).state, "svc:ads"],
      [walk(toContact).state, "submit"],
      [walk(toRequest).state, "restart"],
      [walk(toService).state, "submit"],
      [walk(toService).state, "svc:unknown"],
      [walk(toConfirm).state, "svc:site"],
      [walk(toConfirm).state, "garbage"],
    ];
    for (const [state, data] of cases) {
      const r = run(state, { type: "callback", data });
      expect(r.callbackAnswer).toBe(STALE_BUTTON);
      expect(r.state).toEqual(state);
      expect(r.replies).toEqual([]);
      expect(r.effect).toBeUndefined();
    }
  });

  it("a second 'submit' press after submitting is stale", () => {
    const first = walk([...toConfirm, { type: "callback", data: "submit" }]);
    const second = run(first.state, { type: "callback", data: "submit" });
    expect(second.callbackAnswer).toBe(STALE_BUTTON);
    expect(second.effect).toBeUndefined();
  });

  it("valid callbacks carry no stale answer", () => {
    expect(walk(toName).callbackAnswer).toBeUndefined();
  });

  it("does not mutate the input state", () => {
    const state = walk(toRequest).state;
    const snapshot = structuredClone(state);
    run(state, { type: "text", text: "Нужен лендинг" });
    expect(state).toEqual(snapshot);
  });
});

describe("flow: notification subscription", () => {
  it("a valid notify token subscribes and confirms", () => {
    const r = run(IDLE, { type: "start", payload: "notify_good" });
    expect(r.effect).toEqual({ type: "subscribe" });
    expect(r.state).toEqual(IDLE);
    expect(texts(r)).toBe("Готово, буду присылать уведомления о новых лидах 🔔");
  });

  it("a valid token works in the middle of a dialog and resets it", () => {
    const r = walk([...toContact, { type: "start", payload: "notify_good" }]);
    expect(r.effect).toEqual({ type: "subscribe" });
    expect(r.state).toEqual(IDLE);
  });

  it("an invalid token falls back to the normal start", () => {
    const r = run(IDLE, { type: "start", payload: "notify_bad" });
    expect(r.effect).toBeUndefined();
    expect(r.state.step).toBe("service");
    expect(texts(r)).toContain("Здравствуйте");
  });

  it("an unrelated payload is a normal start", () => {
    const r = run(IDLE, { type: "start", payload: "utm_campaign" });
    expect(r.state.step).toBe("service");
    expect(r.effect).toBeUndefined();
  });
});
