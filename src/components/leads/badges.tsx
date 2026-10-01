import { Bot, PenLine, Send, X, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SOURCE_LABELS, STATUS_LABELS } from "@/lib/constants";
import type { LeadSource, LeadStatus } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

// Полные строки классов: Tailwind собирает только то, что видит в исходниках буквально.
const TAG_STYLES: Record<string, string> = {
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
  cyan: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
  lime: "bg-lime-100 text-lime-800 dark:bg-lime-500/20 dark:text-lime-300",
  fuchsia: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300",
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
};

const TAG_RING: Record<string, string> = {
  blue: "ring-blue-500",
  emerald: "ring-emerald-500",
  amber: "ring-amber-500",
  rose: "ring-rose-500",
  violet: "ring-violet-500",
  cyan: "ring-cyan-500",
  orange: "ring-orange-500",
  lime: "ring-lime-500",
  fuchsia: "ring-fuchsia-500",
  slate: "ring-slate-500",
};

export function tagStyle(color: string): string {
  return TAG_STYLES[color] ?? TAG_STYLES.slate;
}

export function tagRing(color: string): string {
  return TAG_RING[color] ?? TAG_RING.slate;
}

export function TagBadge({ name, color, onRemove, className }: { name: string; color: string; onRemove?: () => void; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("border-0 font-normal", tagStyle(color), onRemove && "pr-1", className)}>
      {name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Снять тег «${name}»`}
          className="rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
        >
          <X className="size-3!" />
        </button>
      )}
    </Badge>
  );
}

const SOURCE_ICONS: Record<LeadSource, LucideIcon> = { bot: Bot, telegram: Send, manual: PenLine };

export function SourceIcon({ source, className }: { source: LeadSource; className?: string }) {
  const Icon = SOURCE_ICONS[source];
  return <Icon className={cn("size-3.5", className)} aria-hidden />;
}

export function SourceBadge({ source }: { source: LeadSource }) {
  return (
    <Badge variant="outline" className="gap-1 font-normal">
      <SourceIcon source={source} />
      {SOURCE_LABELS[source]}
    </Badge>
  );
}

const STATUS_STYLES: Record<LeadStatus, string> = {
  new: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  won: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  lost: "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300",
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-0", STATUS_STYLES[status])}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
