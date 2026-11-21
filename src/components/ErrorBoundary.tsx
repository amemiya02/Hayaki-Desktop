// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { Component, type ReactNode } from "react";

import { Button } from "@/components/ui";
import { t } from "@/lib/i18n";
import { useNav } from "@/lib/nav";

/**
 * Catches a render error in one screen so the rest of the window keeps working.
 * Without it React unmounts the whole tree and the window goes blank.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: unknown }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  componentDidUpdate(previous: { resetKey?: unknown }) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="grid h-full place-items-center bg-bg px-8">
        <div className="max-w-[520px] text-center">
          <h1 className="text-heading font-semibold text-ink">{t("error.title")}</h1>
          <p className="selectable mt-2 text-control text-ink-2">{error.message}</p>
          <div className="mt-5 flex justify-center gap-2">
            <Button onClick={() => useNav.getState().go({ name: "decks" })}>{t("nav.decks")}</Button>
            <Button variant="primary" onClick={() => this.setState({ error: null })}>
              {t("common.retry")}
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
