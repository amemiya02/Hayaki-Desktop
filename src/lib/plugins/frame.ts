// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** One plugin page in a sandboxed frame, for the entry script and for panels. */
import { useEffect, useRef, useState } from "react";

import { tp } from "../strings/plugins";
import { pageUrl } from "./api";
import { attachFrame, LOAD_TIMEOUT_MS, startLoading } from "./host";
import type { FrameKind } from "./rpc";
import { contextOf, type Manifest } from "./types";

export type PluginPage = { entry: true } | { path: string };

/**
 * Loads `page` for the plugin. The page is reported to the freeze guard as
 * loading and given a one-use ticket before the frame gets its address, and
 * the frame's calls are routed from then on. `onSettle` gets null when the
 * page is ready, and the reason when it stops: an error while loading, no
 * load in time, or navigating away. A frame keeps its window when it
 * navigates, so a frame that loads a second page is cut off from the bridge.
 *
 * `manifest`, `kind` and `page` must keep their identity for the frame's life.
 * Render `<iframe ref={ref} src={src} onLoad={onLoad}>` once `src` is set.
 */
export function usePluginFrame(manifest: Manifest, kind: FrameKind, page: PluginPage, onSettle: (error: string | null) => void) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const settle = useRef(onSettle);
  settle.current = onSettle;
  const doneLoading = useRef(() => {});
  const loaded = useRef(() => {});

  useEffect(() => {
    let alive = true;
    void (async () => {
      const done = await startLoading(manifest.id);
      if (!alive) return done();
      doneLoading.current = done;
      try {
        const url = await pageUrl(manifest.id, page);
        if (alive) setSrc(url);
      } catch (error) {
        done();
        if (alive) settle.current(String(error));
      }
    })();
    return () => {
      alive = false;
      doneLoading.current();
    };
  }, [manifest, page]);

  useEffect(() => {
    const win = ref.current?.contentWindow;
    if (!src || !win) return;
    let ready = false;
    let stopped = false;
    let loads = 0;
    const stop = (error: string) => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      doneLoading.current();
      detach();
      settle.current(error);
    };
    const timer = setTimeout(() => stop(tp("loadTimeout")), LOAD_TIMEOUT_MS);
    const detach = attachFrame(
      win,
      { target: win, plugin: contextOf(manifest), frame: kind },
      {
        ready() {
          if (ready || stopped) return;
          ready = true;
          clearTimeout(timer);
          doneLoading.current();
          settle.current(null);
        },
        // Errors after loading are only logged by the SDK.
        error: (message) => !ready && stop(message),
      },
    );
    loaded.current = () => {
      if (++loads > 1) stop(tp("navigated"));
    };
    return () => {
      clearTimeout(timer);
      loaded.current = () => {};
      detach();
    };
  }, [src, manifest, kind]);

  return { ref, src, onLoad: () => loaded.current() };
}
