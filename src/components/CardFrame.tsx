// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Shows Card Content in the card page, an iframe at the media origin. The
 * interface only posts the HTML to render and listens for a few messages
 * back (ready, shown, commands, forwarded keys, typed answers).
 */
import { openUrl } from "@tauri-apps/plugin-opener";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { cardPageUrl } from "@/lib/study/audio";

export interface CardFrameContent {
  html: string;
  css: string;
  bodyClass: string;
  side: "question" | "answer";
  frame: { dark: boolean; vars: Record<string, string>; dir: "ltr" | "rtl"; lang: string };
  flag?: number;
  marked?: boolean;
}

export interface CardFrameHandle {
  typedAnswer(): Promise<string | null>;
  focus(): void;
  scroll(delta: number): void;
}

export interface ForwardedKey {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat: boolean;
}

interface Props {
  content: CardFrameContent | null;
  onCommand?: (cmd: string) => void;
  onKey?: (key: ForwardedKey) => void;
  onShown?: (side: string) => void;
  className?: string;
  title?: string;
}

let typedRequest = 0;

export const CardFrame = forwardRef<CardFrameHandle, Props>(function CardFrame(
  { content, onCommand, onKey, onShown, className, title = "Card" },
  ref,
) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const pending = useRef(new Map<number, (value: string | null) => void>());
  const handlers = useRef({ onCommand, onKey, onShown });
  handlers.current = { onCommand, onKey, onShown };

  const post = useCallback((message: Record<string, unknown>) => {
    iframe.current?.contentWindow?.postMessage({ target: "hayaki-card", ...message }, "*");
  }, []);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow) return;
      const data = event.data as { source?: string; type?: string; [key: string]: unknown };
      if (data?.source !== "hayaki-card") return;
      switch (data.type) {
        case "ready":
          setReady(true);
          break;
        case "cmd":
          handlers.current.onCommand?.(String(data.cmd));
          break;
        case "key":
          handlers.current.onKey?.(data as unknown as ForwardedKey);
          break;
        case "shown":
          handlers.current.onShown?.(String(data.side));
          break;
        case "typed": {
          const resolve = pending.current.get(Number(data.id));
          pending.current.delete(Number(data.id));
          resolve?.((data.value as string | null) ?? null);
          break;
        }
        case "open":
          if (typeof data.url === "string" && /^https?:\/\//i.test(data.url)) void openUrl(data.url);
          break;
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  useEffect(() => {
    if (!ready || !content) return;
    post({
      type: "render",
      html: content.html,
      css: content.css,
      bodyClass: content.bodyClass,
      side: content.side,
      frame: content.frame,
    });
  }, [ready, content, post]);

  useEffect(() => {
    if (ready && content) post({ type: "flag", flag: content.flag ?? 0 });
  }, [ready, content, content?.flag, post]);

  useEffect(() => {
    if (ready && content) post({ type: "mark", marked: !!content.marked });
  }, [ready, content, content?.marked, post]);

  useImperativeHandle(
    ref,
    () => ({
      typedAnswer() {
        if (!ready) return Promise.resolve(null);
        const id = ++typedRequest;
        return new Promise((resolve) => {
          pending.current.set(id, resolve);
          post({ type: "typed", id });
          setTimeout(() => {
            if (pending.current.delete(id)) resolve(null);
          }, 500);
        });
      },
      focus() {
        iframe.current?.focus();
      },
      scroll(delta) {
        post({ type: "scroll", delta });
      },
    }),
    [ready, post],
  );

  return (
    <iframe
      ref={iframe}
      title={title}
      src={cardPageUrl()}
      className={className}
      // Scripts in Card Templates run, but the page has its own origin and
      // no access to the interface or the core.
      sandbox="allow-scripts allow-same-origin allow-popups"
      allow="autoplay"
    />
  );
});
