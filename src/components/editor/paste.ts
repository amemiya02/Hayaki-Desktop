// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Pasting into a field: Anki's two editing preferences, and what they change. */
import { useQuery } from "@tanstack/react-query";

import * as core from "@/lib/anki/generated/core";

/** Shift inverts the preference, as in Anki's editor. */
export function stripsFormatting(preference: boolean, shift: boolean): boolean {
  return preference !== shift;
}

/** A bitmap from the clipboard arrives with a generic name; a file copied from a folder keeps its own. */
export function isClipboardBitmap(file: File): boolean {
  return /^image\/(png|jpeg|bmp|webp|x-.*)$/.test(file.type) && /^(image|blob)?(\.\w+)?$/.test(file.name);
}

const JPEG_QUALITY = 0.8;

/** Re-encodes a pasted bitmap as PNG, or as JPEG when "paste images as PNG" is off. */
export async function encodePastedImage(file: File, asPng: boolean): Promise<File> {
  const type = asPng ? "image/png" : "image/jpeg";
  if (file.type === type) return file;
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    if (!asPng) {
      // JPEG has no transparency.
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, JPEG_QUALITY));
    return blob ? new File([blob], `image.${asPng ? "png" : "jpg"}`, { type }) : file;
  } finally {
    bitmap.close();
  }
}

export interface EditingPrefs {
  stripsFormatting: boolean;
  imagesAsPng: boolean;
}

/** Anki's saved paste preferences. The query is shared with Settings, so a change there applies at once. */
export function useEditingPrefs(): EditingPrefs {
  const { data } = useQuery({ queryKey: ["preferences"], queryFn: () => core.getPreferences() });
  return { stripsFormatting: !!data?.editing?.pasteStripsFormatting, imagesAsPng: !!data?.editing?.pasteImagesAsPng };
}

/** `paste-<sha1 of bytes>.<ext>` as Anki names a pasted bitmap, so the same image pasted twice is one file. */
export async function pastedBitmapName(bytes: Uint8Array, ext: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes as BufferSource));
  return `paste-${[...digest].map((b) => b.toString(16).padStart(2, "0")).join("")}.${ext}`;
}
