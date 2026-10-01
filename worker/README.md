# Воркер userbot

Отдельный сервис мини-CRM (Node 22 + [GramJS](https://github.com/gram-js/gramjs)). Подключается к обычному аккаунту Telegram по MTProto и превращает входящие личные сообщения от незнакомых людей в лиды: отправляет их в `POST /api/ingest` CRM.

## Что делает

- Слушает новые сообщения подключённого аккаунта. В лид попадает только входящее личное сообщение от человека, который не бот, не сам аккаунт, не служебный Telegram (777000) и **не в контактах** (друзья и знакомые — не лиды).
- Имя лида — имя и фамилия, иначе `username`, иначе «Без имени»; контакт — `@username` или `+телефон`. Вместо медиа в тексте стоит пометка («[фото]», «[голосовое сообщение]» и т. п.).
- Отправка в CRM — до 3 попыток с паузой; идемпотентность на стороне CRM по `externalId = <id аккаунта>:<chat>:<message>`.
- **Догонялка.** Railway перезапускает воркер при каждом деплое, а `catchUp()` в GramJS фактически не работает. Поэтому при старте и после восстановления связи воркер берёт последние 30 диалогов, из личных с непрочитанными достаёт до 20 входящих (не старше 48 ч) и пропускает через тот же фильтр. Дубли безопасны: `/api/ingest` идемпотентен.
- Раз в 30 с обновляет `tg_accounts.last_seen_at`. Если сессию отозвали (`AUTH_KEY_UNREGISTERED`, `SESSION_REVOKED`, `USER_DEACTIVATED`), статус становится `disconnected`, сессия стирается. Если связи нет около 90 с — статус `error`, при восстановлении — снова `connected`.
- Сессия (`StringSession`) хранится в `tg_accounts.session_enc`, зашифрованная AES-256-GCM ключом `SESSION_ENC_KEY` (формат `iv.tag.ciphertext`, base64). Ключ есть только у воркера.
- MVP: один аккаунт. Новый вход останавливает прежний клиент и в одной транзакции заменяет строки в `tg_accounts`. `POST /auth/logout` отзывает авторизацию в Telegram (`auth.LogOut`); строка остаётся со `status='disconnected'` и `session_enc=null`.

## Переменные окружения

См. `.env.example`.

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | Postgres CRM (воркер пишет только в `tg_accounts`) |
| `TG_API_ID`, `TG_API_HASH` | данные приложения с <https://my.telegram.org> (API development tools) |
| `SESSION_ENC_KEY` | 64 hex-символа: `openssl rand -hex 32`. Потеряете ключ — придётся входить заново |
| `INGEST_URL` | полный URL `/api/ingest` CRM |
| `INGEST_SECRET` | общий секрет с CRM для `/api/ingest` |
| `WORKER_SECRET` | Bearer-секрет HTTP API воркера (его же знает CRM) |
| `START_DELAY_MS` | пауза перед подключением к Telegram, по умолчанию 20000 мс (см. ниже) |
| `PORT` | порт HTTP API, по умолчанию 8787 (Railway задаёт сам) |

При неверной конфигурации воркер сразу завершается и перечисляет все проблемы.

## Запуск

```bash
cd worker
npm install
cp .env.example .env     # заполнить
npm run dev              # tsx watch, env из .env
npm test                 # vitest
npm run build && npm start
```

Деплой на Railway: root directory — `worker/`, команды берутся из `package.json` (`build` / `start`), healthcheck — `GET /health`.

## Как подключить аккаунт

Через CRM: страница «Каналы» -> «Подключить» -> телефон -> код из Telegram -> пароль 2FA (если включён).

Или напрямую, `Authorization: Bearer $WORKER_SECRET`:

```bash
H="Authorization: Bearer $WORKER_SECRET"; U=https://<worker>.up.railway.app
curl -X POST $U/auth/send-code -H "$H" -H 'content-type: application/json' -d '{"phone":"+79991112233"}'
curl -X POST $U/auth/sign-in   -H "$H" -H 'content-type: application/json' -d '{"code":"12345"}'
# ответ {"needPassword":true} -> пароль 2FA:
curl -X POST $U/auth/password  -H "$H" -H 'content-type: application/json' -d '{"password":"..."}'
curl $U/status -H "$H"
curl -X POST $U/auth/logout -H "$H"
```

Незавершённый вход живёт в памяти 10 минут, одновременно один. Не пересылайте код в самом Telegram: он аннулируется как «скомпрометированный», вводите его только в CRM.

## HTTP API

`GET /health` — без авторизации. Остальное требует `Authorization: Bearer <WORKER_SECRET>`: `GET /status`, `POST /auth/send-code {phone}`, `POST /auth/sign-in {code}`, `POST /auth/password {password}`, `POST /auth/logout`. Ошибки — `{ "error": "текст по-русски" }`.

## Риски

- **Не запускайте воркер локально с прод-`DATABASE_URL` и `SESSION_ENC_KEY`.** Один auth key у двух клиентов одновременно Telegram аннулирует (`AUTH_KEY_DUPLICATED`): воркер сотрёт сессию, и аккаунт придётся подключать заново. Для локальной разработки используйте отдельную базу и отдельный аккаунт.
- Та же проблема возможна при деплое на Railway, когда новый контейнер стартует рядом со старым. Поэтому подключение к Telegram стартует с паузой `START_DELAY_MS` (20 с), а в `railway.json` стоит `overlapSeconds: 0`. `/health` отвечает сразу.
- Userbot — неофициальный клиент. Telegram может ограничить аккаунт, особенно при входе с серверного IP. Подключайте **рабочий или второй аккаунт**, не личный основной.
- Очереди нет. Если CRM недоступна все 3 попытки, сообщение остаётся только в логе (`externalId`); непрочитанное подберёт догонялка при следующем рестарте. Прочитанное вручную в Telegram до этого — уже нет.
- Если у отправителя Telegram не передал флаг «контакт» (редкие «урезанные» профили), он будет считаться незнакомым.
- Логи без текстов сообщений и секретов, но в них есть технические идентификаторы (`externalId`).
