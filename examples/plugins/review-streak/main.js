// Review Streak: counts answers with reviewer.answered and keeps the tally in storage.

// Today's tally lives in plugin storage. The day follows this computer's clock.
const STREAK_KEY = "today";

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function loadTally() {
  const saved = await hayaki.storage.get(STREAK_KEY);
  return saved && saved.day === todayStamp() ? saved : { day: todayStamp(), answered: 0, again: 0 };
}

hayaki.reviewer.injectCss(`
  .hayaki-plugins .review-streak {
    position: fixed; top: 10px; inset-inline-end: 12px;
    padding: 2px 9px; border-radius: 999px;
    font: 600 12px/1.6 system-ui, sans-serif;
    color: var(--accent); background: color-mix(in oklab, var(--accent) 12%, transparent);
  }
`);

function showOnCard(tally) {
  return hayaki.reviewer.injectHtml(`<div class="review-streak">${tally.answered} today</div>`);
}

// Answers are counted one at a time, so quick answering never loses a count.
let queue = loadTally().then(showOnCard);

hayaki.on("reviewer.answered", (event) => {
  queue = queue
    .then(loadTally)
    .then(async (tally) => {
      tally.answered += 1;
      if (event.ease === 1) tally.again += 1;
      await hayaki.storage.set(STREAK_KEY, tally);
      await showOnCard(tally);
    })
    .catch((error) => console.error(error));
});

hayaki.ui.registerCommand(
  { id: "show-count", title: "Show today's answers", shortcut: "Ctrl+Alt+R" },
  async () => {
    const tally = await loadTally();
    await hayaki.ui.toast(`${tally.answered} Cards answered today, ${tally.again} of them Again.`);
  },
);
