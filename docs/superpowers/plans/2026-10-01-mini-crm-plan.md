# Mini-CRM — план реализации и контракты

Спека: `docs/superpowers/specs/2026-10-01-mini-crm-design.md`. Здесь — разбиение на потоки, владение файлами и контракты между ними.

## Уже сделано (лид)

- Каркас Next.js 16 + Tailwind 4 + shadcn/ui (компоненты в `src/components/ui`).
- Схема БД `src/lib/db/schema.ts`, миграция `drizzle/0000_init.sql`, клиент `src/lib/db/index.ts` (`getDb()`, тип `Db`).
- Тестовая БД `src/test/db.ts` (`createTestDb()` — PGlite + миграции).
- `src/lib/tags.ts` (`ensureTags`, `normalizeTagName`, `pickTagColor`, `TAG_COLORS`), `src/lib/constants.ts` (`SOURCE_LABELS`, `STATUS_LABELS`, `SERVICES`).
- Заглушки с финальными сигнатурами: `src/lib/leads/ingest.ts`, `src/lib/notify-token.ts`, `src/lib/bot/info.ts` (реализует `core`).
- Dev-БД Neon в `.env.local` (миграции применены).

## Потоки и владение файлами

Каждый поток правит только свои пути. Остальное — только чтение; если там нужна правка — напиши владельцу или лиду.

| Поток | Владеет |
|---|---|
| `core` | `src/lib/leads/ingest.ts` (+ тест), `src/lib/notify.ts`, `src/lib/notify-token.ts` (+ тест), `src/lib/bot/**` (+ тесты), `src/app/api/telegram/**`, `src/app/api/ingest/**`, `src/app/api/health/**`, `scripts/set-webhook.ts` |
| `ui` | `src/app/**` кроме путей `core`, `src/proxy.ts`, `src/lib/auth.ts`, `src/lib/leads/queries.ts`, `src/lib/leads/actions.ts`, `src/lib/worker-client.ts`, `src/components/**` кроме `src/components/ui/**`, `scripts/seed.ts` |
| `worker` | `worker/**` целиком |
| лид | схема и миграции, `src/lib/db/**`, `src/lib/tags.ts`, `src/lib/constants.ts`, `src/test/**`, `src/components/ui/**`, конфиги, `package.json`, `.env.example`, `README.md`, `docs/**` |

## Контракт 1 — `ingestLead()` (реализует `core`, вызывают бот, `/api/ingest`, ручное добавление в `ui`)

```ts
// src/lib/leads/ingest.ts
export type IngestInput = {
  source: LeadSource;               // "bot" | "telegram" | "manual"
  name: string;
  contact?: string | null;
  request?: string | null;
  tgUserId?: number | null;         // ключ дедупа
  tgUsername?: string | null;
  tags?: string[];                  // имена; недостающие создаются (ensureTags)
  status?: LeadStatus;              // только для ручного добавления; по умолчанию "new"
  isDemo?: boolean;
  message?: { text: string; externalId?: string | null };  // запись в историю
};
export type IngestResult = { lead: Lead; created: boolean; duplicate: boolean };
export async function ingestLead(db: Db, input: IngestInput, opts?: IngestOptions): Promise<IngestResult>;
export type IngestOptions = { notify?: boolean; notifier?: (e: LeadEvent) => Promise<void> };
```

Поведение — спека §4.1. `duplicate: true` — если `message.externalId` уже был (повторная доставка): ничего не меняем. Уведомление по умолчанию шлётся для `bot` и `telegram`, не для `manual`; ошибка уведомления не роняет создание лида.

## Контракт 2 — `POST /api/ingest` (реализует `core`, вызывает `worker`)

- Заголовок `Authorization: Bearer ${INGEST_SECRET}`; иначе 401.
- Тело (JSON): `{ source: "telegram", name, contact?, request?, tgUserId, tgUsername?, message: { text, externalId } }`, где `externalId = "<accountTgUserId>:<chatId>:<messageId>"`.
- Ответ 200: `{ leadId: number, created: boolean, duplicate: boolean }`. 400 — невалидное тело (zod).

## Контракт 3 — HTTP API воркера (реализует `worker`, вызывает `ui` через `src/lib/worker-client.ts` только с сервера)

База: `WORKER_URL`. Каждый запрос: `Authorization: Bearer ${WORKER_SECRET}`; иначе 401. Тела и ответы — JSON. Ошибки: `{ error: string }` с кодом 4xx/5xx, `error` — человекочитаемый текст на русском (его можно показать в UI).

| Метод | Тело | Ответ |
|---|---|---|
| `GET /status` | — | `{ account: null \| AccountInfo, pending: null \| "code" \| "password" }` |
| `POST /auth/send-code` | `{ phone }` | `{ ok: true }` — код отправлен в Telegram |
| `POST /auth/sign-in` | `{ code }` | `{ ok: true, account: AccountInfo }` или `{ needPassword: true }` |
| `POST /auth/password` | `{ password }` | `{ ok: true, account: AccountInfo }` |
| `POST /auth/logout` | — | `{ ok: true }` |

`AccountInfo = { phone, tgUserId, username: string \| null, displayName, status: "connected" \| "disconnected" \| "error", lastSeenAt: string \| null }`.

MVP: подключён максимум один аккаунт. Новый успешный вход заменяет предыдущий.

## Контракт 4 — таблица `tg_accounts`

Пишет только `worker` (сырым SQL через `postgres`). `ui` читает для отображения статуса на странице «Каналы»: аккаунт «онлайн», если `status = 'connected'` и `last_seen_at` моложе 2 минут. Это работает, даже если воркер недоступен по HTTP.

## Контракт 5 — подписка на уведомления (реализует `core`, кнопку показывает `ui`)

```ts
// src/lib/notify-token.ts
export function getNotifySubscribeUrl(): string;          // https://t.me/<TELEGRAM_BOT_USERNAME>?start=notify_<token>
export function verifyNotifyToken(token: string): boolean;
```

## Контракт 6 — информация о боте (реализует `core`, показывает `ui`)

```ts
// src/lib/bot/info.ts
export type BotInfo = { username: string; link: string; webhookUrl: string | null; pendingUpdates: number; lastError: string | null };
export async function getBotInfo(): Promise<BotInfo | null>;  // null — бот не настроен (нет токена)
```

## Переменные окружения

См. `.env.example`. CRM (Vercel): `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `CRM_PASSWORD`, `AUTH_SECRET`, `INGEST_SECRET`, `WORKER_URL`, `WORKER_SECRET`, `APP_URL`, `CHANNELS_LOCKED`. Воркер (Railway): `DATABASE_URL`, `TG_API_ID`, `TG_API_HASH`, `SESSION_ENC_KEY`, `INGEST_URL`, `INGEST_SECRET`, `WORKER_SECRET`, `PORT`.

## Решения по ревью плана (Codex)

- Webhook отвечает 500, если обработка упала до коммита в БД (Telegram повторит), и 200, если упала только отправка ответа. Повтор того же апдейта отсекается по `bot_sessions.last_update_id`.
- `ingestLead`: дубль `externalId` откатывает всю транзакцию; уведомление — после коммита.
- Воркер: догонялка непрочитанных при старте (GramJS `catchUp()` не реализован), `auth.LogOut` при отключении, один слот аккаунта.
- `CHANNELS_LOCKED=1` на проде: проверяющие видят форму подключения, но не могут отключить демо-аккаунт.
- Деплой только на production-домен Vercel (preview закрыты Deployment Protection — webhook туда не достучится).
- Оставлено как есть: лиды только от людей не из контактов (продуктовое решение), токен подписки многоразовый (ссылка доступна только за паролем CRM).

## Порядок

1. Параллельно: `core`, `ui`, `worker`.
2. Лид: интеграция, `next build`, деплой Vercel + Railway, webhook, сквозная проверка на проде.
3. Ревью: Codex (кросс-модельно) + opus.
4. Документ для сдачи.
