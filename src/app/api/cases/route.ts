import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { extractBill } from "@/lib/adapters/nutrient";
import { listCases, saveCase, trailEntry } from "@/lib/adapters/xano";
import type { CaseRecord } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Stage 1: ingest a bill and open a case. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    sampleId?: string;
    pdfBase64?: string;
    filename?: string;
  };

  if (!body.sampleId && !body.pdfBase64) {
    return NextResponse.json(
      { error: "provide either sampleId or pdfBase64" },
      { status: 400 },
    );
  }

  const extraction = await extractBill({
    sampleId: body.sampleId,
    pdfBase64: body.pdfBase64,
    filename: body.filename,
  });

  const { meta, lines, documentConfidence, pageCount } = extraction.data;
  const billedTotal = Number(lines.reduce((s, l) => s + l.charged, 0).toFixed(2));
  const flagged = lines.filter((l) => l.needsReview);

  const record: CaseRecord = {
    id: `case_${randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    status: flagged.length > 0 ? "awaiting_review" : "auditing",
    meta,
    lines,
    findings: [],
    evidence: [],
    trail: [
      trailEntry(
        "Bill received",
        "system",
        "system",
        `${body.filename ?? body.sampleId ?? "bill"} — ${pageCount} page(s), ${lines.length} line items, $${billedTotal.toLocaleString()} billed`,
      ),
      trailEntry(
        "Document extraction",
        extraction.vendor,
        extraction.provenance,
        `${extraction.note}. Document confidence ${(documentConfidence * 100).toFixed(0)}%; ` +
          `${flagged.length} field(s) below the review threshold.`,
      ),
    ],
    billedTotal,
    disputedTotal: 0,
  };

  const saved = await saveCase(record);
  saved.data.trail.push(
    trailEntry("Case opened", saved.vendor, saved.provenance, saved.note),
  );

  return NextResponse.json({
    case: saved.data,
    stage: {
      name: "extract",
      vendor: extraction.vendor,
      provenance: extraction.provenance,
      note: extraction.note,
      ms: extraction.ms,
    },
    needsReview: flagged.map((l) => l.id),
    documentConfidence,
  });
}

export async function GET() {
  const { cases, provenance } = await listCases();
  return NextResponse.json({
    provenance,
    cases: cases.map((c) => ({
      id: c.id,
      createdAt: c.createdAt,
      status: c.status,
      patient: c.meta.patientName,
      provider: c.meta.provider,
      billedTotal: c.billedTotal,
      disputedTotal: c.disputedTotal,
      findingCount: c.findings.length,
      signed: c.signature?.status === "signed",
    })),
  });
}
