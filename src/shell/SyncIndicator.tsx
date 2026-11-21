// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { ScrollText } from "lucide-react";
import { Popover } from "radix-ui";
import { useRef, useState } from "react";

import { Button, cn, Spinner, Tooltip } from "@/components/ui";
import { tr } from "@/lib/i18n";
import { useSync } from "@/lib/sync";

import { syncPill } from "./sync-pill";

/**
 * Sync progress for every screen with a toolbar, and Study's top strip. It
 * grows out of zero width, so nothing beside it jumps. A click opens the full
 * progress with Abort and the Media Log. Progress never covers the screen.
 * `closedClassName` lets a flex row cancel the gap that a collapsed pill leaves.
 */
export function SyncIndicator({ closedClassName }: { closedClassName?: string }) {
  const phase = useSync((s) => s.phase);
  const progress = useSync((s) => s.progress);
  const live = syncPill(phase, progress);
  const [open, setOpen] = useState(false);
  // The pill stays through its collapse instead of vanishing mid-motion.
  const last = useRef(live);
  if (live) last.current = live;
  const pill = live ?? last.current;
  if (!pill) return null;

  return (
    <div
      inert={!live}
      className={cn(
        "grid min-w-0 transition-[grid-template-columns,opacity,margin] duration-[var(--dur)] ease-out",
        live ? "grid-cols-[1fr] opacity-100" : cn("grid-cols-[0fr] opacity-0", closedClassName),
      )}
    >
      <div className="overflow-hidden">
        <Popover.Root open={open && !!live} onOpenChange={setOpen}>
          <Tooltip content={pill.full}>
            <Popover.Trigger asChild>
              <button
                type="button"
                aria-label={pill.full}
                className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2 text-caption tabular-nums text-ink-2 transition-colors duration-[var(--dur-fast)] hover:bg-sidebar-hover data-[state=open]:bg-sidebar-hover"
              >
                <Spinner className="size-3.5" />
                <span className="max-w-40 truncate">{pill.short}</span>
              </button>
            </Popover.Trigger>
          </Tooltip>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={6}
              collisionPadding={12}
              className="z-50 w-[300px] rounded-[10px] border border-line bg-raised p-3 text-control text-ink shadow-pop data-[state=open]:animate-pop-in"
            >
              <div className="font-medium">{pill.title}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-caption tabular-nums text-ink-2" aria-live="polite">
                {pill.parts.length ? (
                  pill.parts.map((part, i) => (
                    <span key={i} className="whitespace-nowrap">
                      {part}
                    </span>
                  ))
                ) : (
                  <span>{pill.abortable ? tr("sync-media-starting") : tr("sync-syncing")}</span>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <Button size="sm" variant="ghost" onClick={() => useSync.getState().showLog(true)}>
                  <ScrollText />
                  {tr("sync-media-log-button")}
                </Button>
                {pill.abortable && (
                  <Button size="sm" onClick={() => useSync.getState().abortMedia()}>
                    {tr("sync-abort-button")}
                  </Button>
                )}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}
