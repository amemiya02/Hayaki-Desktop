// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Small dialogs shared by the Note Type screens. */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button, cn, Dialog, TextField } from "@/components/ui";
import { tr } from "@/lib/i18n";
import { plainLabel } from "@/lib/strings/notetypes";

/** A name prompt (Anki's `getText`): returns the text, or null when cancelled. */
export function NameDialog({
  open,
  title,
  label,
  initial,
  action,
  validate,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  label: string;
  initial: string;
  action?: string;
  /** Returns an error message to show, or null when the name is fine. */
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(initial);
      setError(null);
      // Select the default so typing replaces it, as Qt's getText does.
      requestAnimationFrame(() => input.current?.select());
    }
  }, [open, initial]);

  const submit = () => {
    if (!value.trim()) return;
    const problem = validate?.(value) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    onSubmit(value);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>{tr("actions-cancel")}</Button>
          <Button variant="primary" disabled={!value.trim()} onClick={submit}>
            {action ?? tr("actions-save")}
          </Button>
        </>
      }
    >
      <label className="block">
        <span className="mb-1.5 block text-[12.5px] text-ink-2">{plainLabel(label)}</span>
        <TextField
          ref={input}
          autoFocus
          value={value}
          aria-invalid={!!error}
          aria-describedby={error ? "name-dialog-error" : undefined}
          className={cn(error && "border-danger focus:border-danger focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--danger)_18%,transparent)]")}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
      </label>
      {error && (
        <p id="name-dialog-error" role="alert" className="mt-2 text-[12.5px] text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}

/** A labelled multi-line text area in the app's field style. */
export function TextArea({
  label,
  value,
  onChange,
  rows = 5,
  mono,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] text-ink-2">{label}</span>
      <textarea
        value={value}
        rows={rows}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full resize-y rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none",
          "transition-[border-color,box-shadow] duration-[var(--dur-fast)] hover:border-line-strong focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]",
          mono && "font-mono",
        )}
      />
    </label>
  );
}

/** A checkbox row in the app's style. */
export function Check({
  checked,
  onChange,
  children,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="flex cursor-default items-start gap-2.5 py-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-[3px] size-4 shrink-0 accent-[var(--accent)]"
      />
      <span className="min-w-0">
        <span className="block text-[13px] text-ink">{children}</span>
        {hint && <span className="mt-0.5 block text-[12px] text-ink-3">{hint}</span>}
      </span>
    </label>
  );
}
