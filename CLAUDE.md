@AGENTS.md

# Mini-CRM для заявок агентства

Тестовое задание: мини-CRM, куда лиды попадают из Telegram-бота, из подключённого личного Telegram (userbot) и вручную; лидам ставятся теги и статусы.

- Дизайн: `docs/superpowers/specs/2026-10-01-mini-crm-design.md` — источник правды по поведению.
- План и контракты между модулями: `docs/superpowers/plans/2026-10-01-mini-crm-plan.md`.

## Стек

Next.js 16 (App Router, `src/`), React 19, TypeScript, Tailwind 4 + shadcn/ui (`src/components/ui`), Drizzle ORM + Postgres (Neon), grammY (бот, webhook), Vitest + PGlite (тесты). Воркер userbot — отдельный пакет `worker/` (Node 22 + GramJS), деплоится на Railway.

**Next.js 16 отличается от того, что ты знаешь.** Перед кодом, завязанным на Next (route handlers, server actions, `proxy.ts` вместо middleware, cookies, кэширование), прочитай нужный раздел в `node_modules/next/dist/docs/`.

## Правила

- Весь текст интерфейса и бота — на русском. Комментарии в коде — по-русски и только там, где неочевидно «почему».
- Функции доступа к данным принимают `db: Db` первым параметром (`import type { Db } from "@/lib/db"`). В рантайме передаём `getDb()`, в тестах — `createTestDb()` из `src/test/db.ts` (PGlite с миграциями).
- Схема БД — `src/lib/db/schema.ts`. Менять её может только лид; если нужна правка — напиши лиду.
- Общие хелперы: `src/lib/tags.ts` (`ensureTags`, `pickTagColor`), `src/lib/constants.ts` (подписи источников, статусов, услуги бота).
- Секреты — только из `process.env`, список в `.env.example`. Никогда не коммить `.env*`.
- Тесты: запускай только свои файлы точечно — `npx vitest run <путь>`. Полный прогон тестов, `next build`, `next dev` и `npm install` — только с разрешения лида (машина ограничена по RAM).
- Проверка типов своих файлов: `npx tsc --noEmit` (лёгкая, можно).
- Коммиты делает только лид.
