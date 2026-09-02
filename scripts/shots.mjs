/**
 * Capture the demo flow as screenshots, so the UI can be reviewed without a
 * browser in the loop. Usage: node scripts/shots.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = "tmp-artifacts";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

const shot = async (name, full = false) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log(`  ${name}.png`);
};

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await shot("01-intake");

// Kick off the guided run and catch it at each stage.
await page.getByRole("button", { name: /Run the full demo/i }).click();
await page.waitForTimeout(2600);
await shot("02-extract", true);

// The review gate should be holding the pipeline.
await page.waitForTimeout(1400);
await shot("03-review", true);

// Auto-pilot answers the gate, then the unattended stages run.
await page.waitForTimeout(6000);
await shot("04-audit", true);

await page.waitForTimeout(6000);
await shot("05-evidence", true);

await page.waitForTimeout(7000);
await shot("06-letter", true);

await page.waitForTimeout(9000);
await shot("07-signed", true);

// Light theme, to confirm both palettes resolve.
await page.keyboard.press("l");
await page.waitForTimeout(700);
await shot("08-light", true);

await page.goto(`${BASE}/judges`, { waitUntil: "networkidle" }).catch(() => {});
await page.waitForTimeout(900);
await shot("09-judges", true);

console.log(errors.length ? `\nCONSOLE ERRORS:\n${errors.join("\n")}` : "\nno console errors");
await browser.close();
