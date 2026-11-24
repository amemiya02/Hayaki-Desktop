// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** A profile's picture, or its initial on the accent when it has none. */
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import { cn } from "@/components/ui";

export function Avatar({ name, src, className }: { name: string; src?: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-accent text-control font-semibold text-on-accent",
        className,
      )}
    >
      {src ? <img src={src} alt="" draggable={false} className="size-full object-cover" /> : (Array.from(name.trim())[0]?.toUpperCase() ?? "?")}
    </span>
  );
}

/** Large enough for the biggest avatar on a 2x screen, small enough for `profiles.json`. */
const SIZE = 160;

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
};

/**
 * Asks for a picture and returns it cropped to the centre square and scaled
 * down, as a data URL; null if the person cancelled.
 */
export async function chooseAvatar(): Promise<string | null> {
  const path = await open({ multiple: false, directory: false, filters: [{ name: "Images", extensions: Object.keys(MIME) }] });
  if (typeof path !== "string") return null;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const bytes = await invoke<ArrayBuffer>("read_chosen_file", { path });
  const bitmap = await createImageBitmap(new Blob([bytes], { type: MIME[ext] ?? "application/octet-stream" }));
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.min(SIZE, side);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    // WebKit cannot write WebP and falls back to PNG, which the shell accepts too.
    return canvas.toDataURL("image/webp", 0.86);
  } finally {
    bitmap.close();
  }
}
