// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Right-click menus, styled like the shared dropdown menus in `ui.tsx`
 * (which wrap Radix DropdownMenu; these wrap Radix ContextMenu).
 */
import { Check, ChevronRight } from "lucide-react";
import { ContextMenu } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/components/ui";
import { displayChord } from "@/lib/chord";

const surface =
  "z-50 min-w-[220px] rounded-[10px] border border-line bg-raised p-1 shadow-pop " +
  "data-[state=open]:animate-pop-in";

const item =
  "relative flex h-8 cursor-default select-none items-center gap-2.5 rounded-[6px] px-2.5 text-control text-ink outline-none " +
  "data-[highlighted]:bg-accent-soft data-[disabled]:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-2";

export const CtxRoot = ContextMenu.Root;
export const CtxTrigger = ContextMenu.Trigger;

export function CtxContent({ children }: { children: ReactNode }) {
  return (
    <ContextMenu.Portal>
      <ContextMenu.Content className={surface} collisionPadding={8}>
        {children}
      </ContextMenu.Content>
    </ContextMenu.Portal>
  );
}

export function CtxItem({
  children,
  shortcut,
  onSelect,
  danger,
  disabled,
}: {
  children: ReactNode;
  shortcut?: string;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <ContextMenu.Item
      onSelect={onSelect}
      disabled={disabled}
      className={cn(item, danger && "text-danger [&_svg]:text-danger")}
    >
      {children}
      {shortcut && <span className="tabular ms-auto ps-6 text-caption text-ink-3">{displayChord(shortcut)}</span>}
    </ContextMenu.Item>
  );
}

export function CtxCheck({
  children,
  checked,
  onSelect,
  shortcut,
  icon,
}: {
  children: ReactNode;
  checked: boolean;
  onSelect: () => void;
  shortcut?: string;
  icon?: ReactNode;
}) {
  return (
    <ContextMenu.CheckboxItem
      checked={checked}
      onSelect={(e) => {
        e.preventDefault();
        onSelect();
      }}
      className={cn(item, !icon && "ps-8")}
    >
      {icon ? (
        <>
          {icon}
          {children}
          {shortcut && <span className="tabular ms-auto ps-6 text-caption text-ink-3">{displayChord(shortcut)}</span>}
          <span className={cn("grid size-4 shrink-0 place-items-center", shortcut ? "ms-2" : "ms-auto")}>
            <ContextMenu.ItemIndicator className="inline-flex">
              <Check />
            </ContextMenu.ItemIndicator>
          </span>
        </>
      ) : (
        <>
          <ContextMenu.ItemIndicator className="absolute start-2.5 inline-flex">
            <Check />
          </ContextMenu.ItemIndicator>
          {children}
          {shortcut && <span className="tabular ms-auto ps-6 text-caption text-ink-3">{displayChord(shortcut)}</span>}
        </>
      )}
    </ContextMenu.CheckboxItem>
  );
}

export function CtxSeparator() {
  return <ContextMenu.Separator className="my-1 h-px bg-line" />;
}

export function CtxLabel({ children }: { children: ReactNode }) {
  return <ContextMenu.Label className="px-2.5 pb-1 pt-1.5 text-caption font-medium text-ink-3">{children}</ContextMenu.Label>;
}

export function CtxSub({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <ContextMenu.Sub>
      <ContextMenu.SubTrigger className={cn(item, "data-[state=open]:bg-accent-soft")}>
        {icon}
        {label}
        <ChevronRight className="ms-auto rtl:rotate-180" />
      </ContextMenu.SubTrigger>
      <ContextMenu.Portal>
        <ContextMenu.SubContent sideOffset={4} className={surface}>
          {children}
        </ContextMenu.SubContent>
      </ContextMenu.Portal>
    </ContextMenu.Sub>
  );
}
