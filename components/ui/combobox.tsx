"use client";

import * as React from "react";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

type ComboboxProps<T> = {
  options: T[];
  value: string | null | undefined;
  onChange: (id: string) => void;
  getId: (opt: T) => string;
  getLabel: (opt: T) => string;
  getSearchKeys: (opt: T) => string[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function Combobox<T>({
  options,
  value,
  onChange,
  getId,
  getLabel,
  getSearchKeys,
  placeholder = "Seleccionar",
  searchPlaceholder = "Buscar…",
  emptyMessage = "Sin resultados",
  disabled,
  id,
  className,
}: ComboboxProps<T>) {
  const [open, setOpen] = React.useState(false);

  const selected = React.useMemo(
    () => (value ? options.find((opt) => getId(opt) === value) : undefined),
    [options, value, getId],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={id ? `${id}-listbox` : undefined}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-3 py-2 text-sm whitespace-nowrap transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:hover:bg-input/50",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate text-left">
            {selected ? getLabel(selected) : placeholder}
          </span>
          <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command
          filter={(_optionValue, search, keywords) => {
            const q = normalize(search.trim());
            if (!q) return 1;
            const haystack = normalize((keywords ?? []).join(" "));
            return haystack.includes(q) ? 1 : 0;
          }}
        >
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            {options.map((opt) => {
              const optionId = getId(opt);
              const isSelected = optionId === value;
              return (
                <CommandItem
                  key={optionId}
                  value={optionId}
                  keywords={getSearchKeys(opt)}
                  onSelect={() => {
                    onChange(optionId);
                    setOpen(false);
                  }}
                >
                  <CheckIcon
                    className={cn(
                      "size-4 shrink-0",
                      isSelected ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{getLabel(opt)}</span>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export { Combobox };
export type { ComboboxProps };
