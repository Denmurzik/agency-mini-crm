"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TagBadge } from "./badges";
import type { TagDTO } from "./types";

type Props = {
  /** Все существующие теги. */
  allTags: TagDTO[];
  /** Имена уже выбранных тегов — их в списке не показываем. */
  selected: string[];
  /** Выбран существующий тег или создан новый — родитель решает, что с ним делать. */
  onPick: (name: string) => void | Promise<void>;
  disabled?: boolean;
};

export function TagPicker({ allTags, selected, onPick, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const taken = new Set(selected.map((n) => n.toLowerCase()));
  const available = allTags.filter((t) => !taken.has(t.name.toLowerCase()));
  const typed = query.trim().replace(/\s+/g, " ");
  const exists = typed && allTags.some((t) => t.name.toLowerCase() === typed.toLowerCase());
  const canCreate = typed && !exists;

  function pick(name: string) {
    setOpen(false);
    setQuery("");
    void onPick(name);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="xs" disabled={disabled}>
          <Plus />
          Тег
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Найти или создать тег…" value={query} onValueChange={setQuery} maxLength={40} />
          <CommandList>
            {!canCreate && <CommandEmpty>Нет подходящих тегов</CommandEmpty>}
            {available.length > 0 && (
              <CommandGroup>
                {available.map((t) => (
                  <CommandItem key={t.id} value={t.name} onSelect={() => pick(t.name)}>
                    <TagBadge name={t.name} color={t.color} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {canCreate && (
              <CommandGroup>
                <CommandItem forceMount value={`__create__ ${typed}`} onSelect={() => pick(typed)}>
                  <Plus />
                  Создать тег «{typed}»
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
