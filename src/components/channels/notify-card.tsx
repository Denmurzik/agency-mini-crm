import { Bell, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function NotifyCard({ url, subscribers }: { url: string | null; subscribers: number | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="size-4" />
          Уведомления
        </CardTitle>
        <CardDescription>Сообщение в Telegram при каждом новом лиде и повторном обращении, со ссылкой на карточку.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          {url ? (
            <Button asChild>
              <a href={url} target="_blank" rel="noreferrer">
                Получать уведомления о лидах в Telegram
                <ExternalLink />
              </a>
            </Button>
          ) : (
            <Button disabled>Получать уведомления о лидах в Telegram</Button>
          )}
        </div>
        {!url && <p className="text-sm text-muted-foreground">Подписка недоступна: бот не настроен.</p>}
        {subscribers !== null && (
          <p className="text-sm text-muted-foreground">
            Подписчиков: <span className="font-medium text-foreground tabular-nums">{subscribers}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
