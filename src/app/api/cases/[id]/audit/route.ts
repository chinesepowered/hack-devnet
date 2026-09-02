import { NextResponse } from "next/server";

import { auditBill } from "@/lib/adapters/llm";
import { getCase, trailEntry, updateCase } from "@/lib/adapters/xano";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Stage 3: find the billing errors. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const record = await getCase(id);
  if (!record) {
    return NextResponse.json({ error: `case ${id} not found` }, { status: 404 });
  }

  const audit = await auditBill(record.meta, record.lines);
  const trail = [
    ...record.trail,
    trailEntry("Billing audit", audit.vendor, audit.provenance, audit.note),
  ];

  const updated = await updateCase(id, {
    findings: audit.data.findings,
    disputedTotal: audit.data.totalDisputed,
    status: "benchmarking",
    trail,
  });

  return NextResponse.json({
    case: updated,
    summary: audit.data.summary,
    stage: {
      name: "audit",
      vendor: audit.vendor,
      provenance: audit.provenance,
      note: audit.note,
      ms: audit.ms,
    },
  });
}
