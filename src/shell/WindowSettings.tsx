// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Settings > View: the interface language, zoom and full screen, as in Anki's Preferences and View menu. */
import { ExternalLink, Maximize, Minus, Plus, RotateCcw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button, cn, fieldClass, IconButton, Kbd } from "@/components/ui";
import { displayChord, isMacPlatform } from "./shortcuts";
import { t, tr, trLabel } from "@/lib/i18n";
import { chooseLanguage, LANGUAGES, storedLanguage } from "@/lib/language";
import { ts } from "@/lib/strings/shell";

import { openManual } from "./help";
import { toggleFullscreen } from "./WindowHost";
import { useZoom, ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN, zoom } from "./zoom";

/** A sentence followed by the chords that do it, in this platform's keys. */
function HintKeys({ text, chords }: { text: string; chords: string[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {text}
      {chords.map((chord) => (
        <Kbd key={chord}>{chord}</Kbd>
      ))}
    </span>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-[52px] items-center gap-6 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-body text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-caption text-ink-3">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function WindowSettings() {
  const factor = useZoom((s) => s.factor);
  const [language, setLanguage] = useState(storedLanguage() ?? "");
  const [changing, setChanging] = useState(false);

  const pick = async (code: string) => {
    setLanguage(code);
    setChanging(true);
    try {
      await chooseLanguage(code || null);
    } catch (error) {
      setLanguage(storedLanguage() ?? "");
      setChanging(false);
      toast.error(ts("languageFailed"), { description: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <section className="mt-8 first:mt-0">
      <h2 className="mb-2.5 px-1 text-control font-semibold text-ink-2">{trLabel("qt-accel-view")}</h2>
      <div className="divide-y divide-line overflow-hidden rounded-[12px] border border-line bg-surface">
        <Row label={tr("preferences-language")} hint={ts("languageHint")}>
          <select
            aria-label={tr("preferences-language")}
            value={language}
            disabled={changing}
            onChange={(e) => void pick(e.target.value)}
            className={cn(fieldClass, "w-[260px] max-w-full")}
          >
            <option value="">{t("settings.system")}</option>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label={ts("zoom")} hint={<HintKeys text={ts("zoomHint")} chords={["Ctrl+=", "Ctrl+-", "Ctrl+0"].map((c) => displayChord(c))} />}>
          <div className="flex items-center gap-1">
            <IconButton label={trLabel("qt-accel-zoom-out")} disabled={factor <= ZOOM_MIN} onClick={() => zoom("out")}>
              <Minus />
            </IconButton>
            <span className="w-12 text-center text-control tabular-nums text-ink" aria-live="polite">
              {Math.round(factor * 100)}%
            </span>
            <IconButton label={trLabel("qt-accel-zoom-in")} disabled={factor >= ZOOM_MAX} onClick={() => zoom("in")}>
              <Plus />
            </IconButton>
            <IconButton label={trLabel("qt-accel-reset-zoom")} disabled={factor === ZOOM_DEFAULT} onClick={() => zoom("reset")}>
              <RotateCcw />
            </IconButton>
          </div>
        </Row>
        <Row label={trLabel("qt-accel-full-screen")} hint={<HintKeys text={ts("fullscreenHint")} chords={[isMacPlatform() ? "\u2303\u2318F" : "F11"]} />}>
          <Button onClick={() => void toggleFullscreen()}>
            <Maximize />
            {trLabel("qt-accel-full-screen")}
          </Button>
        </Row>
        <Row label={trLabel("qt-accel-guide")} hint={ts("manualHint")}>
          <Button onClick={() => void openManual()}>
            <ExternalLink />
            {ts("manual")}
          </Button>
        </Row>
      </div>
    </section>
  );
}
