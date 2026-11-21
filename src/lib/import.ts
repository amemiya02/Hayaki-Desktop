// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Importing files. A Deck package (`.apkg`) merges into the open collection
 * after its options are chosen. A collection package (`.colpkg`) replaces it,
 * after the person confirms and a backup has been made. CSV and text files
 * open the import screen with field mapping.
 */
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";

import { confirm } from "@/components/confirm";

import { t, tr } from "./i18n";
import { useNav } from "./nav";
import { resetQueries } from "./queries";
import { ti } from "./strings/import";

async function restoreCollection(file: string): Promise<void> {
  const ok = await confirm({
    title: t("import.replaceTitle"),
    message: t("import.replaceMessage"),
    confirm: t("import.replaceConfirm"),
    danger: true,
  });
  if (!ok) return;
  const id = toast.loading(tr("importing-importing-collection"));
  try {
    await invoke("collection_import_colpkg", { path: file });
    resetQueries();
    toast.success(t("import.replaced"), { id });
  } catch (error) {
    resetQueries();
    toast.error(t("import.failed"), { id, description: error instanceof Error ? error.message : String(error) });
  }
}

export async function importPackage(path?: string): Promise<void> {
  const file =
    path ??
    (await open({
      multiple: false,
      directory: false,
      filters: [
        { name: tr("importing-all-supported-formats", { val: "" }).trim(), extensions: ["apkg", "colpkg", "csv", "tsv", "txt"] },
        { name: ti("anki"), extensions: ["apkg", "colpkg"] },
        { name: ti("text"), extensions: ["csv", "tsv", "txt"] },
      ],
    }));
  if (!file || Array.isArray(file)) return;
  if (file.toLowerCase().endsWith(".colpkg")) return restoreCollection(file);
  if (/\.(csv|tsv|txt)$/i.test(file)) return useNav.getState().go({ name: "import-csv", path: file });
  // The package options dialog loads on first use.
  const { showPackageImport } = await import("@/screens/import-csv/PackageImport");
  showPackageImport(file);
}
