import { NextResponse } from "next/server";

import { generateDisputeLetter } from "@/lib/adapters/doctavian";
import { finalizeDocument } from "@/lib/adapters/foxit";
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

  // The agent's last reversible act on the document itself: optimize it for
  // delivery before anyone is asked to sign it, so the bytes that get hashed
  // are the finished ones.
  const finalized = await finalizeDocument(doc.data.pdfBase64);
  const document = { ...doc.data, pdfBase64: finalized.data.pdfBase64 };

  const trail = [
    ...record.trail,
    trailEntry("Letter generation", doc.vendor, doc.provenance, doc.note),
    trailEntry("Document finalization", finalized.vendor, finalized.provenance, finalized.note),
  ];

  const updated = await updateCase(id, {
    document,
    status: "awaiting_signature",
    trail,
  });

  return NextResponse.json({
    // The PDF is large; the client fetches it from the pdf route instead.
    case: updated ? { ...updated, document: { ...document, pdfBase64: "" } } : updated,
    document: { ...document, pdfBase64: "" },
    stage: {
      name: "generate",
      vendor: doc.vendor,
      provenance: doc.provenance,
      note: doc.note,
      ms: doc.ms,
    },
    finalize: {
      name: "finalize",
      vendor: finalized.vendor,
      provenance: finalized.provenance,
      note: finalized.note,
      ms: finalized.ms,
    },
  });
}
