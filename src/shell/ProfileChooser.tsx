// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Anki's profile window (`aqt/profiles.py`): open, add, rename and delete
 * profiles, and on the very first run a welcome that names the first one.
 */
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { toast } from "sonner";

import { confirm } from "@/components/confirm";
import { Button, cn, Dialog, IconButton, Kbd, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, onAccentKbd, Spinner, TextField } from "@/components/ui";
import { localizedDate, t, tr } from "@/lib/i18n";
import type { ProfileMeta } from "@/lib/profiles";
import { useApp } from "@/lib/session-store";
import { ts } from "@/lib/strings/shell";

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text === "name-exists" ? t("settings.profileExists") : text;
}

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("grid size-8 shrink-0 place-items-center rounded-full bg-accent text-control font-semibold text-on-accent", className)}
    >
      {Array.from(name.trim())[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

function Welcome() {
  const createAndOpen = useApp((s) => s.createAndOpen);
  const [name, setName] = useState(() => tr("profiles-user-1"));
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await createAndOpen(name.trim());
    } catch (error) {
      toast.error(errorText(error));
      setBusy(false);
    }
  };

  return (
    <form
      className="flex w-full max-w-[420px] flex-col items-center text-center animate-rise-in"
      onSubmit={(e) => {
        e.preventDefault();
        void start();
      }}
    >
      <img src="/hayaki-mark.svg" alt="" className="mb-6 size-16" />
      <h1 className="text-headline font-semibold text-ink text-balance">{ts("welcomeTitle")}</h1>
      <p className="mt-2.5 max-w-[46ch] text-body text-ink-2 text-pretty">{ts("welcomeLead")}</p>
      <label className="mt-8 flex w-full flex-col items-start gap-1.5 text-start">
        <span className="text-caption font-medium text-ink-2">{ts("profileName")}</span>
        <TextField autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} className="h-10 text-body" />
      </label>
      <Button type="submit" variant="primary" size="lg" className="mt-4 w-full" disabled={!name.trim() || busy}>
        {busy && <Spinner className="text-on-accent" />}
        {ts("getStarted")}
        <Kbd className={onAccentKbd}>Enter</Kbd>
      </Button>
    </form>
  );
}

function NameDialog({
  open,
  title,
  initial,
  confirmLabel,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initial: string;
  confirmLabel: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(initial), [initial, open]);
  const submit = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(value.trim());
      onClose();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={t("settings.profileHint")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!value.trim() || busy} onClick={() => void submit()}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <TextField
        autoFocus
        aria-label={ts("profileName")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => e.key === "Enter" && void submit()}
      />
    </Dialog>
  );
}

function Chooser() {
  const { profiles, open, rename, remove, createAndOpen } = useApp();
  const [selected, setSelected] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const [naming, setNaming] = useState<{ kind: "new" } | { kind: "rename"; profile: ProfileMeta } | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = profiles[Math.min(selected, profiles.length - 1)];

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.focus();
  }, [selected]);

  const openProfile = async (profile: ProfileMeta | undefined) => {
    if (!profile || opening) return;
    setOpening(profile.id);
    await open(profile.id);
    setOpening(null);
  };

  const deleteProfile = async (profile: ProfileMeta) => {
    if (profiles.length <= 1) {
      toast(tr("qt-misc-there-must-be-at-least-one"));
      return;
    }
    const ok = await confirm({
      title: tr("actions-delete"),
      message: tr("qt-misc-all-cards-notes-and-media-for2", { name: profile.name }),
      confirm: tr("actions-delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await remove(profile.id);
      setSelected((i) => Math.max(0, Math.min(i, profiles.length - 2)));
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (naming) return;
    if (e.key === "ArrowDown") setSelected((i) => Math.min(profiles.length - 1, i + 1));
    else if (e.key === "ArrowUp") setSelected((i) => Math.max(0, i - 1));
    else if (e.key === "Home") setSelected(0);
    else if (e.key === "End") setSelected(profiles.length - 1);
    else if (e.key === "F2" && current) setNaming({ kind: "rename", profile: current });
    else if (e.key === "Delete" && current) void deleteProfile(current);
    else return;
    e.preventDefault();
  };

  return (
    <div className="flex w-full max-w-[440px] flex-col animate-rise-in">
      <div className="flex flex-col items-center text-center">
        <img src="/hayaki-mark.svg" alt="" className="mb-5 size-12" />
        <h1 className="text-headline font-semibold text-ink">{t("profile.choose")}</h1>
        <p className="mt-2 text-body text-ink-2 text-pretty">{ts("chooseLead")}</p>
      </div>

      <ul
        ref={list}
        role="listbox"
        aria-label={tr("profiles-profiles")}
        onKeyDown={onKeyDown}
        className="mt-7 max-h-[min(360px,50vh)] divide-y divide-line-soft overflow-y-auto rounded-[12px] border border-line bg-surface"
      >
        {profiles.map((profile, index) => {
          const isSelected = index === selected;
          return (
            <li
              key={profile.id}
              role="option"
              aria-selected={isSelected}
              data-index={index}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setSelected(index)}
              onDoubleClick={() => void openProfile(profile)}
              onKeyDown={(e) => e.key === "Enter" && void openProfile(profile)}
              className={cn(
                "group flex h-14 items-center gap-3 px-3.5 outline-none transition-colors duration-[var(--dur-fast)]",
                isSelected ? "bg-accent-soft" : "hover:bg-surface-2",
                "focus-visible:shadow-ring-inset",
              )}
            >
              <Avatar name={profile.name} />
              <div className="min-w-0 flex-1">
                <div className={cn("truncate text-body font-medium", isSelected ? "text-accent-ink" : "text-ink")}>{profile.name}</div>
                {profile.created > 0 && (
                  <div className="tabular truncate text-caption text-ink-3">
                    {ts("created", { date: localizedDate(new Date(profile.created * 1000), { dateStyle: "medium" }) })}
                  </div>
                )}
              </div>
              {opening === profile.id && <Spinner />}
              <Menu>
                <MenuTrigger asChild>
                  <IconButton
                    label={ts("profileActions")}
                    size="sm"
                    tabIndex={-1}
                    className="opacity-0 group-hover:opacity-100 group-aria-selected:opacity-100 data-[state=open]:opacity-100"
                  >
                    <MoreHorizontal />
                  </IconButton>
                </MenuTrigger>
                <MenuContent>
                  <MenuItem shortcut="F2" onSelect={() => setNaming({ kind: "rename", profile })}>
                    <Pencil />
                    {tr("actions-rename")}
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem danger shortcut="Del" onSelect={() => void deleteProfile(profile)}>
                    <Trash2 />
                    {tr("actions-delete")}
                  </MenuItem>
                </MenuContent>
              </Menu>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex items-center gap-2">
        <Button variant="ghost" onClick={() => setNaming({ kind: "new" })}>
          <Plus />
          {t("profile.new")}
        </Button>
        <Button variant="primary" className="ms-auto min-w-[96px]" disabled={!current || !!opening} onClick={() => void openProfile(current)}>
          {tr("profiles-open")}
          <Kbd className={onAccentKbd}>Enter</Kbd>
        </Button>
      </div>

      <NameDialog
        open={naming !== null}
        title={naming?.kind === "rename" ? ts("renameProfile") : t("profile.new")}
        initial={naming?.kind === "rename" ? naming.profile.name : ""}
        confirmLabel={naming?.kind === "rename" ? tr("actions-rename") : t("profile.new")}
        onClose={() => setNaming(null)}
        onSubmit={async (name) => {
          if (naming?.kind === "rename") await rename(naming.profile.id, name);
          else await createAndOpen(name);
        }}
      />
    </div>
  );
}

/** Shown while no profile is open. */
export function ProfileChooser() {
  const firstRun = useApp((s) => s.firstRun);
  const empty = useApp((s) => s.profiles.length === 0);
  return (
    <div className="grid h-full place-items-center overflow-y-auto bg-bg px-8 py-10">
      {firstRun || empty ? <Welcome /> : <Chooser />}
    </div>
  );
}
