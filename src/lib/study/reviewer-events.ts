// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** What the reviewer announces as a Card moves through a session; plugins listen (ADR 0004). */

export type ReviewerEvent =
  | { name: "reviewer.questionShown"; cardId: bigint; noteId: bigint }
  | { name: "reviewer.answerShown"; cardId: bigint; noteId: bigint }
  /** `ease` is Anki's 1 (Again) to 4 (Easy). */
  | { name: "reviewer.answered"; cardId: bigint; noteId: bigint; ease: number };

type Listener = (event: ReviewerEvent) => void;
const listeners = new Set<Listener>();

export function onReviewerEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitReviewerEvent(event: ReviewerEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A listener's failure never interrupts the session.
    }
  }
}
