// ЗАГЛУШКА: сигнатура — Контракт 6, реализацию пишет поток `core`.
export type BotInfo = {
  username: string;
  link: string;
  webhookUrl: string | null;
  pendingUpdates: number;
  lastError: string | null;
};

export async function getBotInfo(): Promise<BotInfo | null> {
  throw new Error("getBotInfo: not implemented");
}
