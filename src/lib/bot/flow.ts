import { SERVICES } from "@/lib/constants";
import { verifyNotifyToken } from "@/lib/notify-token";

/**
 * Чистый автомат диалога бота (спека §4.2): без Telegram и БД.
 * `step(state, input, profile) → { state, replies, effect?, callbackAnswer? }`.
 * grammY (bot.ts) только приносит входы, хранит состояние, исполняет эффекты и рисует ответы.
 */

export type Step = "idle" | "service" | "name" | "contact" | "request" | "confirm";

export type Draft = {
  /** Имя тега выбранной услуги. */
  service?: string;
  name?: string;
  contact?: string;
  request?: string;
  /** Номер черновика: растёт с каждым стартом диалога. Кнопки подтверждения старого черновика устаревают. */
  draft?: number;
};

export type FlowState = { step: Step; data: Draft };

/** Данные профиля Telegram отправителя. */
export type Profile = { firstName: string; lastName?: string | null; username?: string | null };

export type FlowInput =
  | { type: "start"; payload?: string }
  | { type: "text"; text: string }
  /** `own` — отправлен собственный контакт пользователя, а не чужой. */
  | { type: "contact"; phone: string; own: boolean }
  | { type: "callback"; data: string }
  /** Стикер, фото, голосовое и прочее нетекстовое. */
  | { type: "other" }
  | { type: "cancel" };

export type ReplyButton = { text: string; requestContact?: boolean };
export type InlineButton = { text: string; data: string };

export type Keyboard =
  | { kind: "inline"; rows: InlineButton[][] }
  | { kind: "reply"; rows: ReplyButton[][]; placeholder?: string }
  | { kind: "remove" };

export type Reply = { text: string; keyboard?: Keyboard };

export type SubmitDraft = { service: string; name: string; contact: string; request: string };

export type Effect = { type: "submit"; draft: SubmitDraft } | { type: "subscribe" };

export type StepResult = {
  state: FlowState;
  replies: Reply[];
  effect?: Effect;
  /** Текст для answerCallbackQuery (только для входов `callback`). */
  callbackAnswer?: string;
};

export const IDLE: FlowState = { step: "idle", data: {} };

export const CB = {
  service: "svc:",
  submit: (draft: number) => `submit:${draft}`,
  restart: (draft: number) => `restart:${draft}`,
} as const;
export const BTN_TG_CONTACT = "✈️ Пишите сюда, в Telegram";
export const BTN_SHARE_PHONE = "📱 Поделиться номером";
export const STALE_BUTTON = "Эта кнопка уже неактуальна";

const NAME_MIN = 2;
const NAME_MAX = 100;
const REQUEST_MIN = 3;
const REQUEST_MAX = 2000;

const noticeConsent = "Нажимая «Отправить», вы соглашаетесь на обработку персональных данных.";

export type FlowDeps = { verifyToken?: (token: string) => boolean };

export function step(state: FlowState, input: FlowInput, profile: Profile, deps: FlowDeps = {}): StepResult {
  const verifyToken = deps.verifyToken ?? verifyNotifyToken;

  if (input.type === "start") {
    const payload = input.payload?.trim();
    if (payload?.startsWith("notify_") && verifyToken(payload.slice("notify_".length))) {
      return {
        state: idleFrom(state),
        replies: [{ text: "Готово, буду присылать уведомления о новых лидах 🔔", keyboard: { kind: "remove" } }],
        effect: { type: "subscribe" },
      };
    }
    return begin(state);
  }

  if (input.type === "cancel") {
    return {
      state: idleFrom(state),
      replies: [{ text: "Заявка отменена. Чтобы начать заново, нажмите /start.", keyboard: { kind: "remove" } }],
    };
  }

  if (input.type === "callback") return onCallback(state, input.data, profile);

  switch (state.step) {
    case "idle":
      return reply(state, "Чтобы оставить заявку, нажмите /start.");
    case "service":
      return reply(state, "Пожалуйста, выберите услугу кнопкой ниже 👇", serviceKeyboard());
    case "name":
      return onName(state, input, profile);
    case "contact":
      return onContact(state, input, profile);
    case "request":
      return onRequest(state, input);
    case "confirm":
      return confirmReply(state);
  }
}

/** Ответы бота после того, как заявка записана в CRM (`id` — номер лида). */
export function submittedReplies(leadId: number): Reply[] {
  return [
    {
      text: `Заявка №${leadId} принята! Менеджер свяжется с вами в ближайшее время.`,
      keyboard: { kind: "remove" },
    },
  ];
}

/** Сводка заявки: показывается на шаге подтверждения и сохраняется в историю лида. */
export function summary(d: SubmitDraft): string {
  return [
    "Ваша заявка:",
    `• Услуга: ${d.service}`,
    `• Имя: ${d.name}`,
    `• Контакт: ${d.contact}`,
    `• Запрос: ${d.request}`,
  ].join("\n");
}

// ── шаги ─────────────────────────────────────────────────────────────────────

const draftNo = (state: FlowState) => state.data.draft ?? 0;
const idleFrom = (state: FlowState): FlowState => ({ step: "idle", data: { draft: draftNo(state) } });

function begin(state: FlowState): StepResult {
  return {
    state: { step: "service", data: { draft: draftNo(state) + 1 } },
    replies: [
      {
        text: "Здравствуйте! Помогу оставить заявку в агентство — это займёт минуту.\n\nЧто вас интересует?",
        keyboard: serviceKeyboard(),
      },
    ],
  };
}

function onCallback(state: FlowState, data: string, profile: Profile): StepResult {
  const stale: StepResult = { state, replies: [], callbackAnswer: STALE_BUTTON };

  if (state.step === "service" && data.startsWith(CB.service)) {
    const service = SERVICES.find((s) => s.key === data.slice(CB.service.length));
    if (!service) return stale;
    return {
      state: { step: "name", data: { ...state.data, service: service.tag } },
      replies: [{ text: `${service.label} — отлично! Как к вам обращаться?`, keyboard: nameKeyboard(profile) }],
    };
  }

  if (state.step === "confirm" && data === CB.submit(draftNo(state))) {
    return { state: idleFrom(state), replies: [], effect: { type: "submit", draft: toDraft(state) } };
  }

  if (state.step === "confirm" && data === CB.restart(draftNo(state))) {
    return begin(state);
  }

  return stale;
}

function onName(state: FlowState, input: FlowInput, profile: Profile): StepResult {
  if (input.type !== "text") return reply(state, "Напишите, пожалуйста, ваше имя текстом.", nameKeyboard(profile));
  const name = input.text.trim().replace(/\s+/g, " ");
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return reply(state, `Имя должно быть от ${NAME_MIN} до ${NAME_MAX} символов. Попробуйте ещё раз.`, nameKeyboard(profile));
  }
  return {
    state: { step: "contact", data: { ...state.data, name } },
    replies: [
      {
        text: "Как с вами связаться? Поделитесь номером, нажмите кнопку «Пишите сюда» или напишите телефон, email или @username.",
        keyboard: contactKeyboard(profile),
      },
    ],
  };
}

function onContact(state: FlowState, input: FlowInput, profile: Profile): StepResult {
  const retry = (text: string) => reply(state, text, contactKeyboard(profile));
  const accept = (contact: string): StepResult => ({
    state: { step: "request", data: { ...state.data, contact } },
    replies: [{ text: "Расскажите коротко, что нужно сделать.", keyboard: { kind: "remove" } }],
  });

  if (input.type === "contact") {
    if (!input.own) return retry("Это чужой контакт. Нажмите «Поделиться номером» — отправится ваш номер.");
    return accept(normalizePhone(input.phone));
  }
  if (input.type !== "text") {
    return retry("Поделитесь номером кнопкой или напишите телефон, email или @username текстом.");
  }

  const text = input.text.trim();
  if (text === BTN_TG_CONTACT) {
    if (!profile.username) return retry("У вас не указан username в Telegram — оставьте телефон или email.");
    return accept(`@${profile.username}`);
  }
  const contact = parseContact(text);
  if (!contact) {
    return retry("Не похоже на контакт. Пример: +7 999 123-45-67, name@mail.ru или @username.");
  }
  return accept(contact);
}

function onRequest(state: FlowState, input: FlowInput): StepResult {
  if (input.type !== "text") return reply(state, "Опишите задачу текстом, пожалуйста.");
  const request = input.text.trim();
  if (request.length < REQUEST_MIN) return reply(state, "Опишите задачу чуть подробнее, пожалуйста.");
  if (request.length > REQUEST_MAX) {
    return reply(state, `Слишком длинно — уложитесь в ${REQUEST_MAX} символов (сейчас ${request.length}).`);
  }
  const next: FlowState = { step: "confirm", data: { ...state.data, request } };
  return confirmReply(next);
}

function confirmReply(state: FlowState): StepResult {
  return {
    state,
    replies: [{ text: `${summary(toDraft(state))}\n\n${noticeConsent}`, keyboard: confirmKeyboard(draftNo(state)) }],
  };
}

// ── вспомогательное ──────────────────────────────────────────────────────────

function reply(state: FlowState, text: string, keyboard?: Keyboard): StepResult {
  return { state, replies: [{ text, keyboard }] };
}

function toDraft(state: FlowState): SubmitDraft {
  const d = state.data;
  return { service: d.service ?? "", name: d.name ?? "", contact: d.contact ?? "", request: d.request ?? "" };
}

function serviceKeyboard(): Keyboard {
  return {
    kind: "inline",
    rows: [SERVICES.map((s) => ({ text: s.label, data: CB.service + s.key }))],
  };
}

function nameKeyboard(profile: Profile): Keyboard {
  const full = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim().slice(0, NAME_MAX);
  if (full.length < NAME_MIN) return { kind: "remove" };
  return { kind: "reply", rows: [[{ text: full }]], placeholder: "Ваше имя" };
}

function contactKeyboard(profile: Profile): Keyboard {
  const rows: ReplyButton[][] = [[{ text: BTN_SHARE_PHONE, requestContact: true }]];
  if (profile.username) rows.push([{ text: BTN_TG_CONTACT }]);
  return { kind: "reply", rows, placeholder: "Телефон, email или @username" };
}

function confirmKeyboard(draft: number): Keyboard {
  return {
    kind: "inline",
    rows: [
      [
        { text: "✅ Отправить", data: CB.submit(draft) },
        { text: "✏️ Заполнить заново", data: CB.restart(draft) },
      ],
    ],
  };
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return `+${digits}`;
}

/** Нестрогая проверка: телефон, email или @username. Возвращает нормализованный контакт либо null. */
export function parseContact(text: string): string | null {
  const t = text.trim();
  if (/^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(t)) return t;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t) && t.length <= 254) return t;
  if (/^\+?[\d\s\-().]+$/.test(t)) {
    const digits = t.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) return t.startsWith("+") ? `+${digits}` : digits;
  }
  return null;
}
