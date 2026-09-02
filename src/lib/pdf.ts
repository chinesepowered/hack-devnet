import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Local PDF rendering.
 *
 * This is the last line of defence in the document pipeline: if both Doctavian
 * and Foxit are unreachable, BillShield still produces a real, paginated,
 * downloadable PDF — and still applies a visible signature block and audit
 * page to it. The demo never degrades to "here's some text on a screen".
 */

const MARGIN = 56;
const PAGE_W = 612; // US Letter
const PAGE_H = 792;
const BODY_SIZE = 10.5;
const LINE_H = 15;

export interface SignatureStamp {
  signerName: string;
  signedAt: string;
  envelopeId: string;
  documentHash: string;
  /** Rendered as the visible "handwritten" mark. */
  typedSignature: string;
  provider: string;
}

interface Cursor {
  page: PDFPage;
  y: number;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    if (rawLine.trim() === "") {
      out.push("");
      continue;
    }
    const words = rawLine.split(/\s+/);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line) out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/**
 * pdf-lib's WinAnsi encoding rejects characters outside Latin-1 (em dashes,
 * curly quotes, the × sign). Letter copy is written for humans, so normalize
 * rather than crash mid-render.
 */
function sanitize(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/×/g, "x")
    .replace(/[•]/g, "-")
    .replace(/ /g, " ")
    // Anything still outside Latin-1 becomes a plain question mark.
    .replace(/[^\x00-\xFF]/g, "?");
}

export async function renderLetterPdf(
  title: string,
  body: string,
  stamp?: SignatureStamp,
  auditLines?: string[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  // A cursive-ish face for the signature mark; Helvetica-Oblique is the closest
  // thing in the standard 14 that still reads as "signed by a person".
  const script = italic;

  const contentW = PAGE_W - MARGIN * 2;
  const ink = rgb(0.09, 0.11, 0.1);
  const muted = rgb(0.42, 0.46, 0.44);
  const accent = rgb(0.06, 0.42, 0.28);

  const cur: Cursor = { page: doc.addPage([PAGE_W, PAGE_H]), y: PAGE_H - MARGIN };

  const newPage = () => {
    cur.page = doc.addPage([PAGE_W, PAGE_H]);
    cur.y = PAGE_H - MARGIN;
  };

  const ensure = (needed: number) => {
    if (cur.y - needed < MARGIN) newPage();
  };

  const write = (
    text: string,
    opts: { font?: PDFFont; size?: number; color?: typeof ink; gap?: number } = {},
  ) => {
    const f = opts.font ?? font;
    const size = opts.size ?? BODY_SIZE;
    const lineHeight = size * 1.42;
    for (const l of wrap(sanitize(text), f, size, contentW)) {
      ensure(lineHeight);
      if (l !== "") {
        cur.page.drawText(l, {
          x: MARGIN,
          y: cur.y - size,
          size,
          font: f,
          color: opts.color ?? ink,
        });
      }
      cur.y -= lineHeight;
    }
    cur.y -= opts.gap ?? 0;
  };

  const rule = (gap = 10) => {
    ensure(gap + 6);
    cur.page.drawLine({
      start: { x: MARGIN, y: cur.y },
      end: { x: PAGE_W - MARGIN, y: cur.y },
      thickness: 0.75,
      color: rgb(0.82, 0.86, 0.83),
    });
    cur.y -= gap;
  };

  // --- Letterhead -----------------------------------------------------------
  cur.page.drawRectangle({
    x: 0,
    y: PAGE_H - 8,
    width: PAGE_W,
    height: 8,
    color: accent,
  });
  write("BILLSHIELD", { font: bold, size: 9, color: accent });
  write("Patient billing dispute prepared with documented evidence", {
    size: 8.5,
    color: muted,
    gap: 8,
  });
  rule(14);

  write(title, { font: bold, size: 15, gap: 10 });

  // --- Body -----------------------------------------------------------------
  for (const block of body.split("\n\n")) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    // Lines we authored as headings are short, all-caps, and colon-free.
    const isHeading = /^[A-Z][A-Z0-9 ,'&/()-]{3,60}$/.test(trimmed) && !trimmed.includes(". ");
    write(trimmed, {
      font: isHeading ? bold : font,
      size: isHeading ? 11 : BODY_SIZE,
      gap: isHeading ? 4 : 9,
    });
  }

  // --- Signature block ------------------------------------------------------
  if (stamp) {
    ensure(150);
    cur.y -= 12;
    rule(18);
    write("ELECTRONICALLY SIGNED", { font: bold, size: 10, color: accent, gap: 10 });

    // The visible signature mark, on its own ruled line.
    ensure(52);
    cur.page.drawText(sanitize(stamp.typedSignature), {
      x: MARGIN + 6,
      y: cur.y - 22,
      size: 22,
      font: script,
      color: rgb(0.07, 0.15, 0.42),
    });
    cur.y -= 34;
    cur.page.drawLine({
      start: { x: MARGIN, y: cur.y },
      end: { x: MARGIN + 260, y: cur.y },
      thickness: 0.9,
      color: ink,
    });
    cur.y -= 14;

    write(stamp.signerName, { font: bold, size: 10 });
    write(`Signed ${stamp.signedAt}`, { size: 9, color: muted });
    write(`Signature provider: ${stamp.provider}`, { size: 9, color: muted });
    write(`Envelope: ${stamp.envelopeId}`, { size: 9, color: muted });
    write(`Document SHA-256: ${stamp.documentHash}`, { size: 8, color: muted, gap: 6 });
    write(
      "This signature was applied by the named individual. The hash above covers the exact bytes " +
        "presented for signature; any later alteration invalidates it.",
      { size: 8, font: italic, color: muted },
    );
  }

  // --- Audit trail page -----------------------------------------------------
  if (auditLines && auditLines.length > 0) {
    newPage();
    cur.page.drawRectangle({
      x: 0,
      y: PAGE_H - 8,
      width: PAGE_W,
      height: 8,
      color: accent,
    });
    write("PROCESSING AUDIT TRAIL", { font: bold, size: 13, gap: 4 });
    write(
      "Every step taken to produce this letter, in order, including which system performed it and " +
        "where a human made the decision.",
      { size: 9, color: muted, gap: 10 },
    );
    rule(12);
    for (const entry of auditLines) {
      write(entry, { size: 8.5, color: ink, gap: 2 });
    }
  }

  // --- Page numbers ---------------------------------------------------------
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, {
      x: PAGE_W - MARGIN - font.widthOfTextAtSize(label, 8),
      y: MARGIN / 2,
      size: 8,
      font,
      color: muted,
    });
  });

  return doc.save();
}

/** Stamp a signature onto an already-rendered PDF, preserving its pages. */
export async function appendSignaturePage(
  pdfBytes: Uint8Array,
  stamp: SignatureStamp,
  auditLines: string[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const page = doc.addPage([PAGE_W, PAGE_H]);
  const accent = rgb(0.06, 0.42, 0.28);
  const muted = rgb(0.42, 0.46, 0.44);
  let y = PAGE_H - MARGIN;

  page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: accent });
  page.drawText("ELECTRONICALLY SIGNED", { x: MARGIN, y, size: 14, font: bold, color: accent });
  y -= 40;

  page.drawText(sanitize(stamp.typedSignature), {
    x: MARGIN + 6,
    y,
    size: 24,
    font: italic,
    color: rgb(0.07, 0.15, 0.42),
  });
  y -= 12;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + 280, y },
    thickness: 0.9,
    color: rgb(0.09, 0.11, 0.1),
  });
  y -= 18;

  for (const [label, value] of [
    ["Signer", stamp.signerName],
    ["Signed at", stamp.signedAt],
    ["Provider", stamp.provider],
    ["Envelope", stamp.envelopeId],
    ["Document SHA-256", stamp.documentHash],
  ]) {
    page.drawText(sanitize(`${label}: ${value}`), {
      x: MARGIN,
      y,
      size: 9,
      font,
      color: rgb(0.09, 0.11, 0.1),
    });
    y -= 14;
  }

  y -= 12;
  page.drawText("AUDIT TRAIL", { x: MARGIN, y, size: 11, font: bold, color: accent });
  y -= 18;
  for (const entry of auditLines) {
    for (const l of wrap(sanitize(entry), font, 8.5, PAGE_W - MARGIN * 2)) {
      if (y < MARGIN) break;
      page.drawText(l, { x: MARGIN, y, size: 8.5, font, color: muted });
      y -= 11.5;
    }
  }

  return doc.save();
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
