"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Серверные данные страницы (heartbeat аккаунта, webhook бота) устаревают — перечитываем по таймеру. */
export function AutoRefresh({ intervalMs }: { intervalMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);
  return null;
}
