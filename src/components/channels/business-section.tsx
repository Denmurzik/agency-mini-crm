import { StatusPill } from "./status-pill";
import { formatRelative } from "@/components/leads/format";

export type BusinessView = {
  connected: boolean;
  ownerName: string | null;
  ownerUsername: string | null;
  /** ISO-строка. */
  lastMessageAt: string | null;
};

/** Приводит ответ `getBusinessStatus` к виду для карточки; дата может прийти и объектом, и строкой. */
export function toBusinessView(
  status: { connected: boolean; ownerName: string | null; ownerUsername: string | null; lastMessageAt: Date | string | null } | null,
): BusinessView {
  if (!status) return { connected: false, ownerName: null, ownerUsername: null, lastMessageAt: null };
  return {
    connected: status.connected,
    ownerName: status.ownerName,
    ownerUsername: status.ownerUsername,
    lastMessageAt: status.lastMessageAt ? new Date(status.lastMessageAt).toISOString() : null,
  };
}

export function BusinessSection({ business, botUsername, loadFailed }: { business: BusinessView; botUsername: string | null; loadFailed: boolean }) {
  const bot = botUsername ? `@${botUsername.replace(/^@/, "")}` : "бота";
  const owner = [business.ownerName, business.ownerUsername && `@${business.ownerUsername.replace(/^@/, "")}`].filter(Boolean).join(" ");

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-medium">
          Telegram Business
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">основной</span>
        </h3>
        <p className="text-xs text-muted-foreground">Официальный API, без риска для аккаунта. Нужен Telegram Premium.</p>
      </div>

      {loadFailed ? (
        <StatusPill tone="error">Не удалось прочитать состояние подключения</StatusPill>
      ) : business.connected ? (
        <div className="flex flex-col gap-1.5">
          <StatusPill tone="ok">Подключён{owner ? `: ${owner}` : ""}</StatusPill>
          <p className="text-xs text-muted-foreground">
            {business.lastMessageAt ? (
              <>
                Последнее сообщение:{" "}
                <time dateTime={business.lastMessageAt} suppressHydrationWarning>
                  {formatRelative(business.lastMessageAt)}
                </time>
              </>
            ) : (
              "Сообщений пока не было"
            )}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <StatusPill tone="idle">Не подключён</StatusPill>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Откройте Настройки Telegram → Telegram для бизнеса → Чат-боты.</li>
            <li>
              Добавьте <span className="font-medium text-foreground">{bot}</span>.
            </li>
            <li>В «Доступ к чатам» выберите «все кроме контактов», чтобы друзья не становились лидами.</li>
          </ol>
        </div>
      )}
    </section>
  );
}
