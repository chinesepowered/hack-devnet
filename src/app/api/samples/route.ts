import { NextResponse } from "next/server";

import { SAMPLE_BILLS } from "@/lib/fixtures/bills";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    samples: SAMPLE_BILLS.map((b) => ({
      id: b.id,
      label: b.label,
      blurb: b.blurb,
      glyph: b.glyph,
      provider: b.extraction.meta.provider,
      total: b.extraction.meta.statedTotal,
      lineCount: b.extraction.lines.length,
    })),
  });
}
