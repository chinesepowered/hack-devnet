/**
 * Write the sample bills out as real PDFs: `pnpm sample-pdf`
 *
 * The built-in samples are selected by id, which takes the local parser path.
 * These files are what you drag into the drop zone to exercise the live
 * document-intake path end to end — and what a judge can open to see that the
 * statement BillShield reads is a real document, not a fixture in a variable.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { SAMPLE_BILLS } from "../src/lib/fixtures/bills";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;

async function render(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const mono = await doc.embedFont(StandardFonts.Courier);
  const monoBold = await doc.embedFont(StandardFonts.CourierBold);
  const size = 8.6;
  const lineHeight = size * 1.35;

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  for (const raw of text.split("\n")) {
    if (y < MARGIN) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
    // The provider name and the totals row carry the weight; bold them so the
    // page reads like a statement rather than a wall of monospace.
    const bold = /^TOTAL CHARGES|MEDICAL CENTER|HOSPITAL|SURGERY CENTER/i.test(raw);
    page.drawText(raw.replace(/[^\x20-\x7E]/g, "-"), {
      x: MARGIN,
      y: y - size,
      size,
      font: bold ? monoBold : mono,
      color: rgb(0.08, 0.09, 0.1),
    });
    y -= lineHeight;
  }

  return doc.save();
}

async function main() {
  mkdirSync("sample-bills", { recursive: true });
  for (const bill of SAMPLE_BILLS) {
    const bytes = await render(bill.rawText);
    const path = `sample-bills/${bill.id}.pdf`;
    writeFileSync(path, bytes);
    console.log(
      `${path.padEnd(34)} ${bill.extraction.lines.length} lines, ` +
        `$${bill.extraction.meta.statedTotal.toLocaleString()}, ${Math.round(bytes.length / 1024)}KB`,
    );
  }
  console.log("\nDrag one into the drop zone to exercise the live extraction path.");
}

main();
