"use client";

import { Button } from "@/components/ui/button";

export default function CrmError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-16 text-center">
      <p className="font-medium">Что-то пошло не так</p>
      <p className="max-w-sm text-sm text-muted-foreground">Не удалось загрузить страницу. Проверьте соединение с базой данных и попробуйте ещё раз.</p>
      <Button variant="outline" onClick={reset}>
        Повторить
      </Button>
    </div>
  );
}
