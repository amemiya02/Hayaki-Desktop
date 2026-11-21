// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** A searchable list in a popover, like Anki's Note Type and Deck choosers. */
import { Command } from "cmdk";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Popover } from "radix-ui";

import { cn, Tooltip } from "@/components/ui";
import { te } from "@/lib/strings/editor";

export interface ChooserItem {
  id: bigint;
  name: string;
}

function ItemName({ name, hierarchical }: { name: string; hierarchical?: boolean }) {
  if (!hierarchical || !name.includes("::")) return <span className="truncate">{name}</span>;
  const parts = name.split("::");
  const leaf = parts.pop();
  return (
    <span className="truncate">
      <span className="text-ink-3">{parts.join(" :: ")} :: </span>
      {leaf}
    </span>
  );
}

export function Chooser({
  label,
  shortcut,
  items,
  value,
  onSelect,
  open,
  onOpenChange,
  searchLabel,
  hierarchical,
  disabled,
}: {
  label: string;
  shortcut?: string;
  items: ChooserItem[];
  value: bigint | null;
  onSelect: (id: bigint) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchLabel: string;
  hierarchical?: boolean;
  disabled?: boolean;
}) {
  const current = items.find((item) => item.id === value);
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Tooltip content={shortcut ? `${label} (${shortcut})` : label}>
        <Popover.Trigger asChild disabled={disabled}>
          <button
            type="button"
            className={cn(
              "flex h-8 min-w-0 max-w-[320px] items-center gap-2 rounded-[8px] border border-line bg-surface ps-2.5 pe-2 text-control",
              "transition-[border-color,box-shadow] duration-[var(--dur-fast)] hover:border-line-strong",
              "data-[state=open]:border-accent data-[state=open]:shadow-ring disabled:opacity-45",
            )}
          >
            <span className="shrink-0 text-ink-3">{label}</span>
            <span className="min-w-0 truncate font-medium text-ink">
              {current ? <ItemName name={current.name} hierarchical={hierarchical} /> : "—"}
            </span>
            <ChevronsUpDown aria-hidden className="ms-auto size-3.5 shrink-0 text-ink-3" />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-[340px] overflow-hidden rounded-[12px] border border-line bg-raised shadow-pop data-[state=open]:animate-pop-in"
        >
          <Command loop label={searchLabel} className="flex max-h-[min(420px,60vh)] flex-col">
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search aria-hidden className="size-4 shrink-0 text-ink-3" />
              <Command.Input
                autoFocus
                placeholder={searchLabel}
                className="h-10 w-full bg-transparent text-control text-ink outline-none placeholder:text-ink-3"
              />
            </div>
            <Command.List className="min-h-0 overflow-auto p-1">
              <Command.Empty className="px-3 py-6 text-center text-control text-ink-3">{te("noMatches")}</Command.Empty>
              {items.map((item) => (
                <Command.Item
                  key={String(item.id)}
                  value={`${item.name}\u0001${item.id}`}
                  keywords={[item.name]}
                  onSelect={() => {
                    onSelect(item.id);
                    onOpenChange(false);
                  }}
                  className="flex h-8 cursor-default items-center gap-2 rounded-[6px] px-2.5 text-control text-ink outline-none data-[selected=true]:bg-accent-soft"
                >
                  <ItemName name={item.name} hierarchical={hierarchical} />
                  {item.id === value && <Check aria-hidden className="ms-auto size-4 shrink-0 text-accent-ink" />}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
