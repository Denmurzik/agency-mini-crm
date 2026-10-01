"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Inbox, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SOURCE_LABELS, STATUS_LABELS } from "@/lib/constants";
import type { LeadStatus } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import { SourceIcon, tagRing, tagStyle } from "./badges";
import { filtersKey, hasFilters, parseFilters, SOURCES, STATUSES, type LeadFilters } from "./filters";
import { LeadSheet } from "./lead-sheet";
import { LeadTable } from "./lead-table";
import { NewLeadDialog } from "./new-lead-dialog";
import type { LeadRowDTO, LeadsPayload } from "./types";

const POLL_MS = 4000;
const HIGHLIGHT_MS = 6000;
const MAX_TOASTS = 3;

type Props = {
  initial: LeadsPayload;
  /** Ключ фильтров, для которого сервер отрисовал `initial`. */
  initialKey: string;
  botUsername: string | null;
};

export function LeadsView({ initial, initialKey, botUsername }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseFilters((k) => searchParams.get(k)), [searchParams]);
  const key = filtersKey(filters);
  const leadParam = Number(searchParams.get("lead"));
  const openId = Number.isInteger(leadParam) && leadParam > 0 ? leadParam : null;

  const [data, setData] = useState({ key: initialKey, payload: initial });
  const [highlighted, setHighlighted] = useState<ReadonlySet<number>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [newOpen, setNewOpen] = useState(false);
  const [search, setSearch] = useState(filters.q);

  // Что уже видели: по нему отличаем новый лид от старого. При смене фильтров список другой — тостов нет.
  const seen = useRef({ key: initialKey, activity: new Map(initial.leads.map((l) => [l.id, l.lastActivityAt])) });
  const currentKey = useRef(key);
  const pollInFlight = useRef(false);
  // Ответы могут прийти не по порядку (опрос + ручное обновление): применяем только самый свежий из запрошенных.
  const requestSeq = useRef(0);
  const appliedSeq = useRef(0);
  // Лиды, созданные самим менеджером: для них тост «Новый лид» не нужен.
  const own = useRef(new Set<number>());
  const pushedQ = useRef(filters.q);

  const setUrl = useCallback((patch: Partial<Record<keyof LeadFilters | "lead", string | number | null>>) => {
    const params = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === "") params.delete(k);
      else params.set(k, String(v));
    }
    const qs = params.toString();
    // Нативный History API синхронизируется с useSearchParams и не гоняет сервер на каждый клик по фильтру.
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);

  const openLead = useCallback((id: number) => setUrl({ lead: id }), [setUrl]);
  const closeLead = useCallback(() => setUrl({ lead: null }), [setUrl]);

  const flash = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    setHighlighted((prev) => new Set([...prev, ...ids]));
    setTimeout(() => setHighlighted((prev) => new Set([...prev].filter((id) => !ids.includes(id)))), HIGHLIGHT_MS);
  }, []);

  const announce = useCallback(
    (fresh: LeadRowDTO[], repeated: LeadRowDTO[]) => {
      flash([...fresh, ...repeated].map((l) => l.id));
      const show = (lead: LeadRowDTO, title: string) =>
        toast(title, {
          description: lead.request ? (lead.request.length > 80 ? `${lead.request.slice(0, 80)}…` : lead.request) : undefined,
          action: { label: "Открыть", onClick: () => openLead(lead.id) },
        });
      for (const lead of fresh.slice(0, MAX_TOASTS)) show(lead, `Новый лид: ${lead.name} · ${SOURCE_LABELS[lead.source]}`);
      if (fresh.length > MAX_TOASTS) toast(`И ещё новых лидов: ${fresh.length - MAX_TOASTS}`);
      for (const lead of repeated.slice(0, MAX_TOASTS)) show(lead, `Повторное обращение: ${lead.name}`);
    },
    [flash, openLead],
  );

  const fetchLeads = useCallback(
    async (forKey: string, silent: boolean) => {
      const seq = ++requestSeq.current;
      try {
        const res = await fetch(`/api/leads${forKey ? `?${forKey}` : ""}`, { cache: "no-store" });
        if (res.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
          return;
        }
        if (!res.ok) return;
        const payload: LeadsPayload = await res.json();
        // Пока шёл запрос, фильтры могли смениться — такой ответ уже никому не нужен.
        if (currentKey.current !== forKey || seq < appliedSeq.current) return;
        appliedSeq.current = seq;

        const prev = seen.current;
        if (prev.key !== forKey) {
          seen.current = { key: forKey, activity: new Map(payload.leads.map((l) => [l.id, l.lastActivityAt])) };
        } else {
          const fresh: LeadRowDTO[] = [];
          const repeated: LeadRowDTO[] = [];
          for (const lead of payload.leads) {
            const known = prev.activity.get(lead.id);
            if (!own.current.has(lead.id)) {
              if (known === undefined) fresh.push(lead);
              else if (known !== lead.lastActivityAt) repeated.push(lead);
            }
            prev.activity.set(lead.id, lead.lastActivityAt);
          }
          if (!silent) announce(fresh, repeated);
        }
        setData({ key: forKey, payload });
      } catch {
        // Сеть моргнула — следующий опрос всё догонит.
      }
    },
    [announce, router],
  );

  useEffect(() => {
    currentKey.current = key;
    // Другие фильтры — сразу грузим свой список, не дожидаясь таймера.
    const immediate = data.key !== key ? setTimeout(() => void fetchLeads(key, true), 0) : undefined;
    const tick = () => {
      if (document.hidden || pollInFlight.current) return;
      pollInFlight.current = true;
      setNow(Date.now());
      void fetchLeads(key, false).finally(() => {
        pollInFlight.current = false;
      });
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearTimeout(immediate);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
    // data.key намеренно не в зависимостях: интервал не нужно пересоздавать после каждого ответа.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fetchLeads]);

  // Поиск: в URL уходит с задержкой, чтобы не дёргать API на каждую букву.
  useEffect(() => {
    const q = search.trim();
    if (q === filters.q) return;
    const timer = setTimeout(() => {
      pushedQ.current = q;
      setUrl({ q });
    }, 300);
    return () => clearTimeout(timer);
  }, [search, filters.q, setUrl]);

  // Фильтр поменялся снаружи (кнопка «назад», сброс) — подтягиваем поле поиска. Свои обновления URL пропускаем,
  // иначе поле перезапишется значением, которое было до последних нажатий.
  useEffect(() => {
    if (filters.q === pushedQ.current) return;
    pushedQ.current = filters.q;
    setSearch(filters.q);
  }, [filters.q]);

  const { leads, facets } = data.payload;
  const stale = data.key !== key;
  const allTags = useMemo(() => facets.tags.map(({ id, name, color }) => ({ id, name, color })), [facets.tags]);
  const statusTotal = STATUSES.reduce((sum, s) => sum + facets.status[s], 0);
  const filtered = hasFilters(filters);
  const visibleTags = facets.tags.filter((t) => t.count > 0 || t.name.toLowerCase() === filters.tag?.toLowerCase());

  function reload() {
    void fetchLeads(key, true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Лиды</h1>
          <span className="text-sm text-muted-foreground tabular-nums">{facets.total}</span>
        </div>
        <Button onClick={() => setNewOpen(true)}>
          <Plus />
          Лид
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по имени, контакту, запросу" className="pl-8" maxLength={100} />
        </div>
        <Select value={filters.source ?? "all"} onValueChange={(v) => setUrl({ source: v === "all" ? null : v })}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Источник">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все источники</SelectItem>
            {SOURCES.map((s) => (
              <SelectItem key={s} value={s}>
                <SourceIcon source={s} />
                {SOURCE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              pushedQ.current = "";
              setUrl({ q: null, status: null, source: null, tag: null });
            }}
          >
            <X />
            Сбросить
          </Button>
        )}
      </div>

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <Tabs value={filters.status ?? "all"} onValueChange={(v) => setUrl({ status: v === "all" ? null : v })}>
          <TabsList>
            <TabsTrigger value="all" className="px-3">
              Все <Count n={statusTotal} />
            </TabsTrigger>
            {STATUSES.map((s: LeadStatus) => (
              <TabsTrigger key={s} value={s} className="px-3">
                {STATUS_LABELS[s]} <Count n={facets.status[s]} />
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {visibleTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Теги">
          {visibleTags.map((t) => {
            const active = t.name.toLowerCase() === filters.tag?.toLowerCase();
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={active}
                onClick={() => setUrl({ tag: active ? null : t.name })}
                className={cn(
                  "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-shadow hover:brightness-95",
                  tagStyle(t.color),
                  active && `ring-2 ring-offset-1 ring-offset-background ${tagRing(t.color)}`,
                )}
              >
                {t.name}
                <span className="tabular-nums opacity-70">{t.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {leads.length === 0 ? (
        <EmptyState filtered={filtered} botUsername={botUsername} onAdd={() => setNewOpen(true)} />
      ) : (
        <div className={cn("overflow-x-auto rounded-xl border bg-card transition-opacity", stale && "opacity-60")}>
          <LeadTable leads={leads} now={now} highlighted={highlighted} activeId={openId} onOpen={openLead} />
        </div>
      )}

      <LeadSheet leadId={openId} summary={leads.find((l) => l.id === openId)} allTags={allTags} onClose={closeLead} onChanged={reload} />
      <NewLeadDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        allTags={allTags}
        onCreated={(id) => {
          own.current.add(id);
          flash([id]);
          reload();
        }}
      />
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="text-xs tabular-nums text-muted-foreground">{n}</span>;
}

function EmptyState({ filtered, botUsername, onAdd }: { filtered: boolean; botUsername: string | null; onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-14 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">{filtered ? <Search className="size-5" /> : <Inbox className="size-5" />}</div>
      {filtered ? (
        <>
          <p className="font-medium">Ничего не найдено</p>
          <p className="text-sm text-muted-foreground">Попробуйте изменить или сбросить фильтры.</p>
        </>
      ) : (
        <>
          <p className="font-medium">Лидов пока нет</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Напишите боту {botUsername ? <span className="font-medium text-foreground">@{botUsername.replace(/^@/, "")}</span> : "в Telegram"} или добавьте лида вручную.
          </p>
          <Button variant="outline" size="sm" className="mt-2" onClick={onAdd}>
            <Plus />
            Добавить лида
          </Button>
        </>
      )}
    </div>
  );
}
