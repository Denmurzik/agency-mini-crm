import { cn } from "@/lib/utils";

const TONES = {
  ok: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  error: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  idle: "bg-muted text-muted-foreground",
} as const;

export function StatusPill({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex h-5 w-fit items-center gap-1.5 rounded-full px-2 text-xs font-medium", TONES[tone])}>
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
