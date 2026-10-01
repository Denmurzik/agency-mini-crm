import type { Update } from "grammy/types";
import { handleUpdate } from "@/lib/bot/bot";
import { secretsEqual } from "@/lib/bot/secret";

export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secretsEqual(request.headers.get("x-telegram-bot-api-secret-token"), secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update: Update;
  try {
    update = (await request.json()) as Update;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    await handleUpdate(update);
  } catch (err) {
    // Не зафиксировали (БД недоступна и т.п.) — 500, Telegram повторит апдейт; повтор безопасен
    // (update_id + externalId). Ошибки отправки ответа сюда не доходят: бот логирует их сам.
    console.error("[webhook] update handling failed", err);
    return Response.json({ ok: false }, { status: 500 });
  }
  return Response.json({ ok: true });
}
