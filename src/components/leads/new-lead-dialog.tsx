"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { STATUS_LABELS } from "@/lib/constants";
import type { LeadStatus } from "@/lib/db/schema";
import { createLeadAction } from "@/lib/leads/actions";
import { TagBadge } from "./badges";
import { STATUSES } from "./filters";
import { TagPicker } from "./tag-picker";
import type { TagDTO } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allTags: TagDTO[];
  onCreated: (id: number) => void;
};

export function NewLeadDialog({ open, onOpenChange, allTags, onCreated }: Props) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [request, setRequest] = useState("");
  const [status, setStatus] = useState<LeadStatus>("new");
  const [tagNames, setTagNames] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setContact("");
    setRequest("");
    setStatus("new");
    setTagNames([]);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await createLeadAction({ name, contact, request, status, tags: tagNames });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(`Лид «${name.trim()}» добавлен`);
      reset();
      onOpenChange(false);
      onCreated(res.data.id);
    } catch {
      setError("Не удалось сохранить лида, проверьте соединение");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новый лид</DialogTitle>
          <DialogDescription>Заявка, которая пришла не через бота: звонок, письмо, встреча.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lead-name">Имя</Label>
            <Input id="lead-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Анна Петрова" maxLength={120} required autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lead-contact">Контакт</Label>
            <Input id="lead-contact" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="@username, телефон или e-mail" maxLength={200} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lead-request">Запрос</Label>
            <Textarea id="lead-request" value={request} onChange={(e) => setRequest(e.target.value)} placeholder="Что нужно клиенту" maxLength={4000} rows={3} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Статус</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as LeadStatus)}>
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
              {tagNames.map((n) => (
                <TagBadge
                  key={n}
                  name={n}
                  color={allTags.find((t) => t.name.toLowerCase() === n.toLowerCase())?.color ?? "slate"}
                  onRemove={() => setTagNames((prev) => prev.filter((x) => x !== n))}
                />
              ))}
              <TagPicker allTags={allTags} selected={tagNames} onPick={(n) => setTagNames((prev) => [...prev, n])} />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending && <LoaderCircle className="animate-spin" />}
              Добавить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
