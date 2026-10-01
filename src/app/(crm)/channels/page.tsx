import type { Metadata } from "next";
import { connection } from "next/server";
import { count, desc, sql } from "drizzle-orm";
import { AutoRefresh } from "@/components/channels/auto-refresh";
import { BotCard } from "@/components/channels/bot-card";
import { NotifyCard } from "@/components/channels/notify-card";
import { TelegramAccountCard, type AccountView } from "@/components/channels/telegram-account-card";
import { formatRelative, maskPhone } from "@/components/leads/format";
import { getBotInfo, type BotInfo } from "@/lib/bot/info";
import { getDb } from "@/lib/db";
import { notifySubscribers, tgAccounts } from "@/lib/db/schema";
import { getNotifySubscribeUrl } from "@/lib/notify-token";

export const metadata: Metadata = { title: "Каналы · Mini CRM" };

// Аккаунт считается онлайн, пока воркер присылает heartbeat (раз в 30 с) — с запасом на пропущенный.
const ONLINE_WINDOW_MS = 2 * 60_000;

async function loadAccount(): Promise<AccountView | null> {
  const [row] = await getDb()
    .select()
    .from(tgAccounts)
    // Подключённый аккаунт важнее старых отключённых записей, среди равных — самый свежий.
    .orderBy(sql`(${tgAccounts.status} = 'connected') desc`, sql`${tgAccounts.lastSeenAt} desc nulls last`, desc(tgAccounts.id))
    .limit(1);
  if (!row) return null;
  const now = Date.now();
  const online = row.status === "connected" && !!row.lastSeenAt && now - row.lastSeenAt.getTime() < ONLINE_WINDOW_MS;
  return {
    status: row.status,
    online,
    phone: maskPhone(row.phone),
    username: row.username,
    displayName: row.displayName,
    lastSeen: row.lastSeenAt ? formatRelative(row.lastSeenAt.toISOString(), now) : null,
  };
}

export default async function ChannelsPage() {
  // Статусы каналов живые: страница не должна пререндериться на этапе сборки.
  await connection();
  const [botResult, accountResult, subscribersResult] = await Promise.allSettled([
    getBotInfo(),
    loadAccount(),
    getDb().select({ n: count() }).from(notifySubscribers),
  ]);

  let notifyUrl: string | null = null;
  try {
    notifyUrl = getNotifySubscribeUrl();
  } catch {
    // Бот не настроен (нет токена/username) — кнопка будет недоступна.
  }

  const bot: BotInfo | null | "error" = botResult.status === "fulfilled" ? botResult.value : "error";

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh intervalMs={30_000} />
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Каналы</h1>
        <p className="text-sm text-muted-foreground">Откуда лиды попадают в CRM и куда приходят уведомления.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <BotCard bot={bot} />
        <NotifyCard url={notifyUrl} subscribers={subscribersResult.status === "fulfilled" ? (subscribersResult.value[0]?.n ?? 0) : null} />
        <div className="lg:col-span-2">
          <TelegramAccountCard locked={process.env.CHANNELS_LOCKED === "1"} account={accountResult.status === "fulfilled" ? accountResult.value : null} loadFailed={accountResult.status === "rejected"} />
        </div>
      </div>
    </div>
  );
}
