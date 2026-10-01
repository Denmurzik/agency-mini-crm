import { Bot, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BotInfo } from "@/lib/bot/info";
import { StatusPill } from "./status-pill";

const ERROR_FRESH_MS = 15 * 60_000;

/** Telegram не сбрасывает last_error после восстановления: ошибка актуальна, если свежая или копятся необработанные апдейты. */
function hasActiveError(bot: BotInfo): boolean {
  if (!bot.lastError) return false;
  const fresh = !!bot.lastErrorDate && Date.now() - new Date(bot.lastErrorDate).getTime() < ERROR_FRESH_MS;
  return fresh || bot.pendingUpdates > 0;
}

function webhookStatus(bot: BotInfo, failing: boolean) {
  if (!bot.webhookUrl) return <StatusPill tone="warn">Webhook не настроен</StatusPill>;
  if (failing) return <StatusPill tone="error">Webhook: ошибка</StatusPill>;
  return <StatusPill tone="ok">Webhook работает</StatusPill>;
}

export function BotCard({ bot }: { bot: BotInfo | null | "error" }) {
  const failing = bot !== null && bot !== "error" && hasActiveError(bot);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="size-4" />
          Telegram-бот
        </CardTitle>
        <CardDescription>Клиент проходит диалог с ботом, заявка попадает в CRM с тегом выбранной услуги.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {bot === "error" ? (
          <div>
            <StatusPill tone="error">Не удалось получить состояние бота</StatusPill>
          </div>
        ) : bot === null ? (
          <>
            <div>
              <StatusPill tone="idle">Не настроен</StatusPill>
            </div>
            <p className="text-sm text-muted-foreground">Задайте TELEGRAM_BOT_TOKEN и TELEGRAM_BOT_USERNAME в окружении.</p>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {bot.username ? (
                <Button asChild variant="outline" size="sm">
                  <a href={bot.link} target="_blank" rel="noreferrer">
                    @{bot.username}
                    <ExternalLink />
                  </a>
                </Button>
              ) : (
                <StatusPill tone="warn">Имя бота неизвестно</StatusPill>
              )}
              {webhookStatus(bot, failing)}
            </div>
            {failing && bot.lastError && <p className="rounded-lg bg-destructive/10 p-2.5 text-sm break-words text-destructive">{bot.lastError}</p>}
            {bot.webhookUrl && <p className="text-xs text-muted-foreground">В очереди обновлений: {bot.pendingUpdates}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
