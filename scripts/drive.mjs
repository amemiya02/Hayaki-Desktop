// Development only: drives the running app over WebView2's DevTools port
// (start it with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222)
// and saves screenshots for visual review.
//
//   node scripts/drive.mjs <out-dir> '<json steps>'
//
// Steps: {"click": "<selector>"}, {"press": "Space"}, {"wait": 500},
//        {"shot": "name"}, {"eval": "js"}, {"hover": "<selector>"}
import { chromium } from "playwright-core";

const [outDir, stepsJson] = process.argv.slice(2);
const steps = JSON.parse(stepsJson ?? "[]");
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => !p.url().startsWith("devtools"));
if (!page) throw new Error("no page");
page.on("console", (m) => m.type() === "error" && console.log("console error:", m.text()));
page.on("pageerror", (e) => console.log("page error:", e.message));

for (const step of steps) {
  if (step.click) await page.locator(step.click).first().click({ timeout: 5000 });
  if (step.hover) await page.locator(step.hover).first().hover({ timeout: 5000 });
  if (step.drag) {
    const [[x1, y1], [x2, y2]] = step.drag;
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 });
    await page.mouse.move(x2, y2, { steps: 4 });
    await page.mouse.up();
  }
  if (step.press) await page.keyboard.press(step.press);
  if (step.type) await page.keyboard.type(step.type);
  if (step.wait) await page.waitForTimeout(step.wait);
  if (step.eval) console.log(JSON.stringify(await page.evaluate(step.eval)));
  if (step.size) await page.setViewportSize(step.size).catch(() => undefined);
  if (step.shot) {
    await page.waitForTimeout(350);
    const path = `${outDir}/${step.shot}.png`;
    await page.screenshot({ path });
    console.log("shot", path);
  }
}
await browser.close().catch(() => undefined);
