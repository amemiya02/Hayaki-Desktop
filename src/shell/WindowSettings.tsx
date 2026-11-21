// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Settings > View: the interface language, zoom and full screen, as in Anki's Preferences and View menu. */
import { ExternalLink, Maximize, Minus, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SettingsRow, SettingsSection } from "@/components/settings";
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
    <SettingsSection title={trLabel("qt-accel-view")}>
        <SettingsRow label={tr("preferences-language")} hint={ts("languageHint")}>
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
        </SettingsRow>
        <SettingsRow label={ts("zoom")} hint={<HintKeys text={ts("zoomHint")} chords={["Ctrl+=", "Ctrl+-", "Ctrl+0"].map((c) => displayChord(c))} />}>
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
        </SettingsRow>
        <SettingsRow label={trLabel("qt-accel-full-screen")} hint={<HintKeys text={ts("fullscreenHint")} chords={[isMacPlatform() ? "\u2303\u2318F" : "F11"]} />}>
          <Button onClick={() => void toggleFullscreen()}>
            <Maximize />
            {trLabel("qt-accel-full-screen")}
          </Button>
        </SettingsRow>
        <SettingsRow label={trLabel("qt-accel-guide")} hint={ts("manualHint")}>
          <Button onClick={() => void openManual()}>
            <ExternalLink />
            {ts("manual")}
          </Button>
        </SettingsRow>
    </SettingsSection>
  );
}
