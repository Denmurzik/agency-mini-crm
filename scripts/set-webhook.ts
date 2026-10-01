import { Api } from "grammy";

// Запуск: npm run bot:set-webhook (переменные из .env.local).
function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Не задана переменная окружения ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const api = new Api(need("TELEGRAM_BOT_TOKEN"));
  const secret = need("TELEGRAM_WEBHOOK_SECRET");
  const url = `${need("APP_URL").replace(/\/+$/, "")}/api/telegram/webhook`;

  if (!url.startsWith("https://")) {
    console.warn(`Внимание: Telegram принимает webhook только по HTTPS, а APP_URL даёт ${url}`);
  }

  await api.setWebhook(url, {
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  console.log(`Webhook установлен: ${url}`);

  await api.setMyCommands([
    { command: "start", description: "Оставить заявку" },
    { command: "cancel", description: "Отменить заявку" },
  ]);
  await api.setMyShortDescription("Оставьте заявку в агентство — менеджер свяжется с вами.");
  await api.setMyDescription(
    "Здравствуйте! Здесь можно оставить заявку в агентство: выберите услугу, расскажите о задаче и оставьте контакт. Менеджер свяжется с вами в ближайшее время.",
  );
  console.log("Команды и описание бота обновлены.");

  console.log("getWebhookInfo:", await api.getWebhookInfo());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
