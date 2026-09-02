/** Capture one viewport-sized screenshot after driving the demo. */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const WAIT = Number(process.argv[3] ?? 30000);
const NAME = process.argv[4] ?? "view";
const SCROLL = process.argv[5] ?? "";

mkdirSync("tmp-artifacts", { recursive: true });
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.getByRole("button", { name: /Run the full demo/i }).click();
await page.waitForTimeout(WAIT);

if (SCROLL) {
  await page.evaluate((sel) => {
    document.querySelector(sel)?.scrollIntoView({ block: "center" });
  }, SCROLL);
  await page.waitForTimeout(500);
}

await page.screenshot({ path: `tmp-artifacts/${NAME}.png` });
console.log(`${NAME}.png`, errors.length ? `ERRORS: ${errors.join("; ")}` : "");
await browser.close();
