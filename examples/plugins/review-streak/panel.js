// The panel shows the tally the entry script keeps, and refreshes after each answer.

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

async function render() {
  const tally = await loadTally();
  document.getElementById("answered").textContent = String(tally.answered);
  document.getElementById("again").textContent = tally.answered ? `${tally.again} answered Again` : "Study a Deck to start today's count.";
}

// The entry script writes the new tally right after the answer; read it a moment later.
hayaki.on("reviewer.answered", () => setTimeout(render, 250));

document.getElementById("browse").addEventListener("click", () => {
  hayaki.ui.navigate({ to: "browse", search: "rated:1" });
});

render();
