"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, LoaderCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { STATUS_LABELS } from "@/lib/constants";
import type { LeadStatus } from "@/lib/db/schema";
import { addTagAction, deleteLeadAction, removeTagAction, updateLeadAction } from "@/lib/leads/actions";
import { SourceBadge, SourceIcon, TagBadge } from "./badges";
import { STATUSES } from "./filters";
import { formatDateTime, formatShortDateTime, telegramLink } from "./format";
import { TagPicker } from "./tag-picker";
import type { LeadDetailDTO, LeadRowDTO, TagDTO } from "./types";

type Props = {
  leadId: number | null;
  /** Строка из списка — показываем заголовок сразу, пока грузится карточка. */
  summary: LeadRowDTO | undefined;
  allTags: TagDTO[];
  onClose: () => void;
  /** Что-то изменилось — родителю пора перечитать список. */
  onChanged: () => void;
};

type Form = { name: string; contact: string; request: string };

const toForm = (l: LeadRowDTO): Form => ({ name: l.name, contact: l.contact ?? "", request: l.request ?? "" });

export function LeadSheet({ leadId, summary, allTags, onClose, onChanged }: Props) {
  return (
    <Sheet open={leadId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 p-0 data-[side=right]:sm:max-w-md">
        {leadId !== null && <LeadSheetBody key={leadId} leadId={leadId} summary={summary} allTags={allTags} onClose={onClose} onChanged={onChanged} />}
      </SheetContent>
    </Sheet>
  );
}

function LeadSheetBody({ leadId, summary, allTags, onClose, onChanged }: Omit<Props, "leadId"> & { leadId: number }) {
  const [detail, setDetail] = useState<LeadDetailDTO | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [form, setForm] = useState<Form>({ name: "", contact: "", request: "" });
  const router = useRouter();
  // base — последние значения с сервера: в состоянии для рендера, в ref для асинхронных обработчиков.
  const [base, setBase] = useState<Form | null>(null);
  const baseRef = useRef<Form | null>(null);
  // Поллинг и перезагрузка после мутации могут обгонять друг друга: применяем только ответ на последний запрос.
  const requestSeq = useRef(0);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Активность из списка (поллинг) меняется — перечитываем карточку: могло прийти новое сообщение.
  const activity = summary?.lastActivityAt;

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const res = await fetch(`/api/leads/${leadId}`, { cache: "no-store" });
      if (seq !== requestSeq.current) return;
      if (res.status === 404) return setState("missing");
      if (res.status === 401) return router.replace("/login");
      if (!res.ok) return setState((s) => (s === "ready" ? s : "error"));
      const data: LeadDetailDTO = await res.json();
      if (seq !== requestSeq.current) return;
      setDetail(data);
      setState("ready");
      // Не затираем то, что менеджер сейчас печатает: обновляем форму, только если она не менялась.
      const next = toForm(data.lead);
      const prev = baseRef.current;
      setForm((current) => {
        const pristine = !prev || (current.name === prev.name && current.contact === prev.contact && current.request === prev.request);
        return pristine ? next : current;
      });
      baseRef.current = next;
      setBase(next);
    } catch {
      setState((s) => (s === "ready" ? s : "error"));
    }
  }, [leadId, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка внешних данных при открытии и при новой активности
    void load();
  }, [load, activity]);

  const lead = detail?.lead ?? summary;
  const dirty = !!base && (form.name !== base.name || form.contact !== base.contact || form.request !== base.request);

  async function save() {
    setSaving(true);
    try {
      const res = await updateLeadAction(leadId, form);
      if (!res.ok) return void toast.error(res.error);
      baseRef.current = form;
      setBase(form);
      toast.success("Сохранено");
      await load();
      onChanged();
    } catch {
      toast.error("Не удалось сохранить, проверьте соединение");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(status: LeadStatus) {
    if (!detail) return;
    const previous = detail;
    requestSeq.current++; // запрос, начатый до правки, уже устарел
    setDetail({ ...detail, lead: { ...detail.lead, status } });
    try {
      const res = await updateLeadAction(leadId, { status });
      if (!res.ok) throw new Error(res.error);
      onChanged();
    } catch (err) {
      setDetail(previous);
      toast.error(err instanceof Error ? err.message : "Не удалось сменить статус");
    }
  }

  async function addTag(name: string) {
    try {
      const res = await addTagAction(leadId, name);
      if (!res.ok) return void toast.error(res.error);
      await load();
      onChanged();
    } catch {
      toast.error("Не удалось добавить тег");
    }
  }

  async function removeTag(tag: TagDTO) {
    if (!detail) return;
    const previous = detail;
    requestSeq.current++;
    setDetail({ ...detail, lead: { ...detail.lead, tags: detail.lead.tags.filter((t) => t.id !== tag.id) } });
    try {
      const res = await removeTagAction(leadId, tag.id);
      if (!res.ok) throw new Error(res.error);
      onChanged();
    } catch {
      setDetail(previous);
      toast.error("Не удалось снять тег");
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      const res = await deleteLeadAction(leadId);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Лид удалён");
      setDeleteOpen(false);
      onClose();
      onChanged();
    } catch {
      toast.error("Не удалось удалить лида");
    } finally {
      setDeleting(false);
    }
  }

  const tgLink = lead ? telegramLink(lead) : null;

  if (state === "missing") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <SheetTitle>Лид не найден</SheetTitle>
        <SheetDescription>Возможно, его уже удалили.</SheetDescription>
        <Button variant="outline" onClick={onClose}>
          Закрыть
        </Button>
      </div>
    );
  }

  return (
    <>
      <SheetHeader className="border-b p-4 pr-12">
        <SheetTitle className="flex items-center gap-2 text-base">
          <span className="truncate">{lead?.name ?? "Загрузка…"}</span>
          {lead?.isDemo && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">демо</span>}
        </SheetTitle>
        <SheetDescription className="flex items-center gap-2">
          {lead ? <SourceBadge source={lead.source} /> : <Skeleton className="h-5 w-16" />}
          <span>Лид №{leadId}</span>
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto p-4">
        {state === "error" && <p className="mb-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">Не удалось загрузить карточку. Обновится при следующей попытке.</p>}
        {!detail && state !== "error" ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : detail ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sheet-name">Имя</Label>
                <Input id="sheet-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sheet-contact">Контакт</Label>
                <Input id="sheet-contact" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} maxLength={200} placeholder="—" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sheet-request">Запрос</Label>
                <Textarea id="sheet-request" value={form.request} onChange={(e) => setForm({ ...form, request: e.target.value })} maxLength={4000} rows={3} placeholder="—" />
              </div>
              {dirty && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={save} disabled={saving || !form.name.trim()}>
                    {saving && <LoaderCircle className="animate-spin" />}
                    Сохранить
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => base && setForm(base)} disabled={saving}>
                    Отмена
                  </Button>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Статус</Label>
              <Select value={detail.lead.status} onValueChange={(v) => changeStatus(v as LeadStatus)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Теги</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                {detail.lead.tags.map((t) => (
                  <TagBadge key={t.id} name={t.name} color={t.color} onRemove={() => removeTag(t)} />
                ))}
                <TagPicker allTags={allTags} selected={detail.lead.tags.map((t) => t.name)} onPick={addTag} />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label>История сообщений</Label>
              {detail.messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">Сообщений пока нет.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {detail.messages.map((m) => (
                    <li key={m.id} className="rounded-lg border bg-muted/30 p-2.5">
                      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <SourceIcon source={m.source} className="size-3" />
                        <time dateTime={m.createdAt}>{formatShortDateTime(m.createdAt)}</time>
                      </div>
                      <p className="text-sm break-words whitespace-pre-wrap">{m.text}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <dt>Создан</dt>
              <dd>{formatDateTime(detail.lead.createdAt)}</dd>
              <dt>Последняя активность</dt>
              <dd>{formatDateTime(detail.lead.lastActivityAt)}</dd>
            </dl>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t p-3">
        <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)} disabled={!detail}>
          <Trash2 />
          Удалить
        </Button>
        {tgLink && (
          <Button asChild variant="outline" size="sm">
            <a href={tgLink} target="_blank" rel="noreferrer">
              <ExternalLink />
              Открыть в Telegram
            </a>
          </Button>
        )}
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить лида?</DialogTitle>
            <DialogDescription>
              Карточка «{lead?.name}» и вся история сообщений будут удалены без возможности восстановления.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={remove} disabled={deleting}>
              {deleting && <LoaderCircle className="animate-spin" />}
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
