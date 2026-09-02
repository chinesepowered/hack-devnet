import { NextResponse } from "next/server";

import { benchmarkPrices } from "@/lib/adapters/serpapi";
import { getCase, trailEntry, updateCase } from "@/lib/adapters/xano";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Stage 4: prove the prices are inflated with outside evidence. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const record = await getCase(id);
  if (!record) {
    return NextResponse.json({ error: `case ${id} not found` }, { status: 404 });
  }

  const benchmark = await benchmarkPrices(record.lines, record.findings);
  const trail = [
    ...record.trail,
    trailEntry(
      "Price benchmarking",
      benchmark.vendor,
      benchmark.provenance,
      `${benchmark.note}. Compared ${benchmark.data.evidence.length} codes against published reference rates.`,
    ),
  ];

  const updated = await updateCase(id, {
    evidence: benchmark.data.evidence,
    status: "drafting",
    trail,
  });

  return NextResponse.json({
    case: updated,
    stage: {
      name: "benchmark",
      vendor: benchmark.vendor,
      provenance: benchmark.provenance,
      note: benchmark.note,
      ms: benchmark.ms,
    },
  });
}
