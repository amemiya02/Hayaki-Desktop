// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { useEffect, useState } from "react";

import { applyAppearance, resolveAppearance, usePrefs, watchSystemAppearance } from "./prefs";
import type { ResolvedAppearance } from "./themes";

/** Keeps the document's Theme and Appearance in step with the preferences and the OS. */
export function useAppearanceSync(): void {
  const theme = usePrefs((s) => s.theme);
  const appearance = usePrefs((s) => s.appearance);
  useEffect(() => {
    applyAppearance(theme, appearance);
    return watchSystemAppearance(() => applyAppearance(theme, appearance));
  }, [theme, appearance]);
}

export function useResolvedAppearance(): ResolvedAppearance {
  const appearance = usePrefs((s) => s.appearance);
  const [resolved, setResolved] = useState(() => resolveAppearance(appearance));
  useEffect(() => {
    setResolved(resolveAppearance(appearance));
    return watchSystemAppearance(() => setResolved(resolveAppearance(appearance)));
  }, [appearance]);
  return resolved;
}

/* ------------------------------ Window material ------------------------------ */

/**
 * The OS backdrop behind the window, as configured in `tauri.conf.json`
 * (`windowEffects`: Mica on Windows, the sidebar vibrancy on macOS).
 * `null` means the window is drawn opaque.
 */
export type Material = "mica" | "vibrancy" | null;

export type Platform = "windows" | "mac" | "linux";

/**
 * macOS vibrancy needs a transparent window, which Tauri allows only with
 * `app.macOSPrivateApi` (and the `macos-private-api` Cargo feature). Until the
 * shell enables both, the Mac window stays opaque.
 */
export const MAC_VIBRANCY_ENABLED = true;

export function platformOf(userAgent: string): Platform {
  if (/Windows/i.test(userAgent)) return "windows";
  if (/Mac OS X|Macintosh/i.test(userAgent)) return "mac";
  return "linux";
}

/**
 * Which backdrop the OS really draws. Mica exists from Windows 11, which
 * reports a platform version of 13 or more; Windows 10 keeps the opaque path
 * because the window would otherwise show the desktop through the sidebar.
 */
export function materialFor(platform: Platform, platformVersion: string | undefined, macVibrancy = MAC_VIBRANCY_ENABLED): Material {
  if (platform === "windows") {
    const major = Number.parseInt(platformVersion ?? "", 10);
    return Number.isFinite(major) && major >= 13 ? "mica" : null;
  }
  if (platform === "mac") return macVibrancy ? "vibrancy" : null;
  return null;
}

const MATERIAL_KEY = "hayaki.material";

interface UADataLike {
  getHighEntropyValues?: (hints: string[]) => Promise<{ platformVersion?: string }>;
}

async function detectMaterial(): Promise<Material> {
  const platform = platformOf(navigator.userAgent);
  if (platform !== "windows") return materialFor(platform, undefined);
  const data = (navigator as Navigator & { userAgentData?: UADataLike }).userAgentData;
  try {
    const values = await data?.getHighEntropyValues?.(["platformVersion"]);
    return materialFor(platform, values?.platformVersion);
  } catch {
    return null;
  }
}

function applyMaterial(material: Material): void {
  const root = document.documentElement;
  if (material) root.dataset.material = material;
  else delete root.dataset.material;
  try {
    localStorage.setItem(MATERIAL_KEY, material ?? "");
  } catch {
    // The cached value only saves one frame at start-up.
  }
}

/** Marks the document with the platform and its window material (read by app.css). */
export function useWindowMaterial(): void {
  useEffect(() => {
    document.documentElement.dataset.platform = platformOf(navigator.userAgent);
    let live = true;
    void detectMaterial().then((material) => live && applyMaterial(material));
    return () => {
      live = false;
    };
  }, []);
}
