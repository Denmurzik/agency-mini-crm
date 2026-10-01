"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { SourceBadge, StatusBadge, TagBadge } from "./badges";
import { formatDateTime, formatRelative } from "./format";
import type { LeadRowDTO } from "./types";

type Props = {
  leads: LeadRowDTO[];
  now: number;
  highlighted: ReadonlySet<number>;
  activeId: number | null;
  onOpen: (id: number) => void;
};

export function LeadTable({ leads, now, highlighted, activeId, onOpen }: Props) {
  return (
    <Table className="min-w-[860px]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[190px]">Имя</TableHead>
          <TableHead className="w-[150px]">Контакт</TableHead>
          <TableHead>Запрос</TableHead>
          <TableHead className="w-[110px]">Источник</TableHead>
          <TableHead className="w-[100px]">Статус</TableHead>
          <TableHead className="w-[190px]">Теги</TableHead>
          <TableHead className="w-[110px] text-right">Активность</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {leads.map((lead) => (
          <TableRow
            key={lead.id}
            tabIndex={0}
            onClick={() => onOpen(lead.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(lead.id);
              }
            }}
            data-state={activeId === lead.id ? "selected" : undefined}
            className={cn("cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-none", highlighted.has(lead.id) && "lead-flash")}
          >
            <TableCell className="font-medium">
              <div className="flex items-center gap-2">
                <span className="max-w-[150px] truncate">{lead.name}</span>
                {lead.isDemo && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">демо</span>}
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground">
              <span className="block max-w-[140px] truncate">{lead.contact ?? "—"}</span>
            </TableCell>
            <TableCell className="text-muted-foreground">
              <span className="block max-w-[320px] truncate" title={lead.request ?? undefined}>
                {lead.request ?? "—"}
              </span>
            </TableCell>
            <TableCell>
              <SourceBadge source={lead.source} />
            </TableCell>
            <TableCell>
              <StatusBadge status={lead.status} />
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {lead.tags.map((t) => (
                  <TagBadge key={t.id} name={t.name} color={t.color} />
                ))}
              </div>
            </TableCell>
            <TableCell className="text-right text-muted-foreground">
              {/* Время форматируется в часовом поясе читателя, на сервере он другой — расхождение при гидратации ожидаемо. */}
              <time dateTime={lead.lastActivityAt} title={formatDateTime(lead.lastActivityAt)} suppressHydrationWarning className="whitespace-nowrap">
                {formatRelative(lead.lastActivityAt, now)}
              </time>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
