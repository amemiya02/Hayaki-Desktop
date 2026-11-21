// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** How permissions and panel icons read in the interface. */
import {
  BarChart3,
  BookOpen,
  Brain,
  Calendar,
  Clock,
  Eye,
  Flame,
  Globe,
  GraduationCap,
  HardDrive,
  Layers,
  LayoutPanelLeft,
  ListChecks,
  PencilLine,
  Puzzle,
  Sparkles,
  Star,
  Tags,
  Target,
  Timer,
  Trophy,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/components/ui";
import type { Manifest, Permission } from "@/lib/plugins/types";
import { tp } from "@/lib/strings/plugins";

/** The icons a panel may name in its manifest; anything else shows a puzzle piece. */
const PANEL_ICONS: Record<string, LucideIcon> = {
  "bar-chart": BarChart3,
  "book-open": BookOpen,
  brain: Brain,
  calendar: Calendar,
  clock: Clock,
  flame: Flame,
  "graduation-cap": GraduationCap,
  layers: Layers,
  "list-checks": ListChecks,
  puzzle: Puzzle,
  sparkles: Sparkles,
  star: Star,
  tags: Tags,
  target: Target,
  timer: Timer,
  trophy: Trophy,
};

export function panelIcon(name: string | undefined): LucideIcon {
  return (name && PANEL_ICONS[name]) || Puzzle;
}

type Grant = Permission | "storage";

const GRANTS: Record<Grant, { icon: LucideIcon; label: (m: Manifest) => string; hint: () => string; caution?: boolean }> = {
  "collection:read": { icon: Eye, label: () => tp("permCollectionRead"), hint: () => tp("hintCollectionRead") },
  "collection:write": { icon: PencilLine, label: () => tp("permCollectionWrite"), hint: () => tp("hintCollectionWrite"), caution: true },
  reviewer: { icon: GraduationCap, label: () => tp("permReviewer"), hint: () => tp("hintReviewer") },
  ui: { icon: LayoutPanelLeft, label: () => tp("permUi"), hint: () => tp("hintUi") },
  network: { icon: Globe, label: (m) => tp("permNetwork", { origins: m.network.join(", ") }), hint: () => tp("hintNetwork"), caution: true },
  storage: { icon: HardDrive, label: () => tp("permStorage"), hint: () => tp("hintStorage") },
};

const ORDER: Grant[] = ["collection:write", "collection:read", "network", "reviewer", "ui", "storage"];

/** Every grant the manifest asks for, most powerful first, with storage (always granted) last. */
export function grantsOf(manifest: Manifest): Grant[] {
  const asked = new Set<Grant>([...manifest.permissions, "storage"]);
  // Write includes read, so read is not listed twice.
  if (asked.has("collection:write")) asked.delete("collection:read");
  return ORDER.filter((g) => asked.has(g));
}

export function PermissionChips({ manifest }: { manifest: Manifest }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={tp("asksTo")}>
      {grantsOf(manifest)
        .filter((g) => g !== "storage")
        .map((g) => {
          const { icon: Icon, label, caution } = GRANTS[g];
          return (
            <li
              key={g}
              className={cn(
                "inline-flex h-6 max-w-full items-center gap-1.5 rounded-full px-2.5 text-caption",
                caution ? "bg-[color-mix(in_oklab,var(--danger)_var(--tint-pill),transparent)] text-danger" : "bg-surface-2 text-ink-2",
              )}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{label(manifest)}</span>
            </li>
          );
        })}
    </ul>
  );
}

/**
 * What an update changes: grants the new version adds (network counts as new
 * when its origins change) and grants it no longer asks for.
 */
export function grantChanges(previous: Manifest, next: Manifest): { added: Set<Grant>; removed: Grant[] } {
  const before = grantsOf(previous);
  const after = grantsOf(next);
  const sameOrigins = previous.network.join(" ") === next.network.join(" ");
  const added = new Set(after.filter((g) => !before.includes(g) || (g === "network" && !sameOrigins)));
  return { added, removed: before.filter((g) => !after.includes(g)) };
}

/** The grants the manifest asks for; with `previous`, those new since that version are marked. */
export function PermissionList({ manifest, previous }: { manifest: Manifest; previous?: Manifest | null }) {
  const changes = previous ? grantChanges(previous, manifest) : null;
  return (
    <>
      <ul className="divide-y divide-line overflow-hidden rounded-[10px] border border-line">
        {grantsOf(manifest).map((g) => {
          const { icon: Icon, label, hint, caution } = GRANTS[g];
          return (
            <li key={g} className="flex gap-3 px-3.5 py-2.5">
              <Icon className={cn("mt-0.5 size-4 shrink-0", caution ? "text-danger" : "text-ink-2")} aria-hidden />
              <div className="min-w-0">
                <div className="text-control font-medium text-ink">
                  {label(manifest)}
                  {changes?.added.has(g) && (
                    <span className="ms-2 rounded-full bg-accent-soft px-1.5 py-px align-[1px] text-caption font-medium text-accent-ink">
                      {tp("newGrant")}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-caption text-ink-3">{hint()}</div>
              </div>
            </li>
          );
        })}
      </ul>
      {previous && changes && changes.removed.length > 0 && (
        <p className="mt-1.5 text-caption text-ink-3">
          {tp("noLongerAsks", { list: changes.removed.map((g) => GRANTS[g].label(previous)).join(", ") })}
        </p>
      )}
    </>
  );
}
