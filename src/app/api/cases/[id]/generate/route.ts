import { NextResponse } from "next/server";

import { generateDisputeLetter } from "@/lib/adapters/doctavian";
import { getCase, trailEntry, updateCase } from "@/lib/adapters/xano";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Stage 5: assemble the dispute letter. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const record = await getCase(id);
  if (!record) {
    return NextResponse.json({ error: `case ${id} not found` }, { status: 404 });
  }
  if (record.findings.length === 0) {
    return NextResponse.json(
      { error: "run the audit before generating a letter" },
      { status: 409 },
    );
  }

  const reviewed = record.lines.filter((l) => l.reviewedBy);
  const doc = await generateDisputeLetter({
    meta: record.meta,
    lines: record.lines,
    findings: record.findings,
    evidence: record.evidence,
    billedTotal: record.billedTotal,
    disputedTotal: record.disputedTotal,
    reviewer: reviewed[0]?.reviewedBy,
    reviewedCount: reviewed.length,
  });

  const trail = [
    ...record.trail,
    trailEntry("Letter generation", doc.vendor, doc.provenance, doc.note),
  ];

  const updated = await updateCase(id, {
    document: doc.data,
    status: "awaiting_signature",
    trail,
  });

  return NextResponse.json({
    // The PDF is large; the client fetches it from the pdf route instead.
    case: updated ? { ...updated, document: { ...doc.data, pdfBase64: "" } } : updated,
    document: { ...doc.data, pdfBase64: "" },
    stage: {
      name: "generate",
      vendor: doc.vendor,
      provenance: doc.provenance,
      note: doc.note,
      ms: doc.ms,
    },
  });
}
