// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { lazy, Suspense } from "react";

import { Spinner } from "@/components/ui";
import { useNav } from "@/lib/nav";

export type NotetypeTab = "fields" | "templates" | "styling";

// The screens (and CodeMirror) load on first use, so other areas can import
// `openNotetypes` without pulling them in.
const List = lazy(() => import("./List").then((m) => ({ default: m.NotetypeList })));
const Editor = lazy(() => import("./Editor").then((m) => ({ default: m.NotetypeEditor })));

function Loading() {
  return (
    <div className="grid h-full place-items-center">
      <Spinner className="size-5" />
    </div>
  );
}

/** Opens Manage Note Types. */
export function openNotetypes(): void {
  useNav.getState().go({ name: "notetypes" });
}

/** Opens one Note Type's editor. */
export function openNotetype(notetypeId: bigint, tab?: NotetypeTab): void {
  useNav.getState().go({ name: "notetype", notetypeId, tab });
}

/** Manage Note Types (Anki's Tools > Manage Note Types). */
export function NotetypesScreen() {
  return (
    <Suspense fallback={<Loading />}>
      <List />
    </Suspense>
  );
}

/** One Note Type's fields, Card Templates and styling. */
export function NotetypeEditorScreen({ notetypeId, tab }: { notetypeId: bigint; tab?: NotetypeTab }) {
  return (
    <Suspense fallback={<Loading />}>
      <Editor notetypeId={notetypeId} tab={tab} />
    </Suspense>
  );
}
