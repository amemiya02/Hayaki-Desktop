// Copies the parts of MathJax 3 the card page needs into src-tauri/card/mathjax,
// which the app embeds and serves at http://media.localhost/_hayaki/mathjax/.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules/mathjax/es5");
const target = join(root, "src-tauri/card/mathjax");

if (!existsSync(source)) {
  console.warn("mathjax is not installed; skipping card assets");
  process.exit(0);
}
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const part of [
  "tex-chtml-full.js",
  "input/tex/extensions",
  "output/chtml/fonts/woff-v2",
]) {
  cpSync(join(source, part), join(target, part), { recursive: true });
}
console.log(`Copied MathJax to ${target}`);
