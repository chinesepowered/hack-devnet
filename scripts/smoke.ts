/**
 * End-to-end smoke test of the pipeline, with no browser and no network.
 *
 * Run it before a demo: `pnpm smoke`. It exercises every stage through the
 * same adapters the app uses, so if this passes, the fallback path is sound.
 */

import { mkdirSync, writeFileSync } from "node:fs";

import { extractBill } from "../src/lib/adapters/nutrient";
import { auditBill } from "../src/lib/adapters/llm";
import { benchmarkPrices } from "../src/lib/adapters/serpapi";
import { generateDisputeLetter } from "../src/lib/adapters/doctavian";
import { applySignature, requestSignature } from "../src/lib/adapters/foxit";
import { formatTrail, trailEntry } from "../src/lib/adapters/xano";
import { SAMPLE_BILLS } from "../src/lib/fixtures/bills";
import type { AuditTrailEntry } from "../src/lib/types";

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function badge(provenance: string): string {
  return provenance === "live" ? "LIVE    " : "FALLBACK";
}

async function runOne(sampleId: string, writePdf: boolean) {
  const sample = SAMPLE_BILLS.find((s) => s.id === sampleId)!;
  console.log(`\n${"=".repeat(78)}`);
  console.log(`  ${sample.label} — ${sample.extraction.meta.provider}`);
  console.log("=".repeat(78));

  const trail: AuditTrailEntry[] = [];

  // 1. Extract
  const extraction = await extractBill({ sampleId });
  trail.push(
    trailEntry("Extraction", extraction.vendor, extraction.provenance, extraction.note),
  );
  const lines = extraction.data.lines;
  const billed = lines.reduce((s, l) => s + l.charged, 0);
  const flagged = lines.filter((l) => l.needsReview);
  console.log(
    `[${badge(extraction.provenance)}] extract    ${lines.length} lines, ${money(billed)} billed, ` +
      `${flagged.length} need review  (${extraction.ms}ms)`,
  );

  if (Math.abs(billed - sample.extraction.meta.statedTotal) > 0.5) {
    throw new Error(
      `line items sum to ${money(billed)} but the statement says ${money(sample.extraction.meta.statedTotal)}`,
    );
  }

  // 2. Human review (simulated: confirm every flagged row)
  const reviewed = lines.map((l) =>
    l.needsReview
      ? { ...l, confidence: 1, needsReview: false, reviewedBy: "Demo Reviewer", reviewedAt: new Date().toISOString() }
      : l,
  );
  trail.push(
    trailEntry(
      "Human review",
      "nutrient",
      "live",
      `Confirmed ${flagged.length} low-confidence field(s)`,
      "Demo Reviewer",
    ),
  );
  console.log(`[HUMAN   ] review     confirmed ${flagged.length} flagged field(s)`);

  // 3. Audit
  const audit = await auditBill(extraction.data.meta, reviewed);
  trail.push(trailEntry("Audit", audit.vendor, audit.provenance, audit.note));
  console.log(
    `[${badge(audit.provenance)}] audit      ${audit.data.findings.length} findings, ` +
      `${money(audit.data.totalDisputed)} disputed  (${audit.ms}ms)`,
  );

  if (audit.data.findings.length === 0) {
    throw new Error("audit found nothing — the planted errors are not being detected");
  }
  if (audit.data.totalDisputed > billed) {
    throw new Error(
      `disputed ${money(audit.data.totalDisputed)} exceeds billed ${money(billed)} — double counting`,
    );
  }

  // Every finding must reference lines that exist.
  const ids = new Set(reviewed.map((l) => l.id));
  for (const f of audit.data.findings) {
    for (const lid of f.lineIds) {
      if (!ids.has(lid)) throw new Error(`finding ${f.id} references unknown line ${lid}`);
    }
  }

  // No line may be disputed by more than one full-amount rule.
  const fullDispute = new Map<string, string>();
  for (const f of audit.data.findings) {
    if (f.kind === "price_gouging" || f.kind === "upcoding" || f.kind === "quantity_error") continue;
    for (const lid of f.lineIds) {
      if (fullDispute.has(lid)) {
        throw new Error(
          `line ${lid} disputed twice: ${fullDispute.get(lid)} and ${f.id}`,
        );
      }
      fullDispute.set(lid, f.id);
    }
  }

  // No line may have more disputed against it than it was charged. The rules
  // engine guarantees this internally; model-added findings are allocated the
  // same way, so the invariant has to hold across both.
  const allocated = new Map<string, number>();
  for (const f of audit.data.findings) {
    const covered = f.lineIds.reduce(
      (s, id) => s + (reviewed.find((l) => l.id === id)?.charged ?? 0),
      0,
    );
    for (const id of f.lineIds) {
      const line = reviewed.find((l) => l.id === id)!;
      const share =
        covered > 0 ? (line.charged / covered) * f.disputedAmount : f.disputedAmount / f.lineIds.length;
      allocated.set(id, (allocated.get(id) ?? 0) + share);
    }
  }
  for (const [id, amount] of allocated) {
    const line = reviewed.find((l) => l.id === id)!;
    if (amount > line.charged + 0.01) {
      throw new Error(
        `line ${id} (${line.code}) charged ${money(line.charged)} but ${money(amount)} is disputed against it`,
      );
    }
  }

  for (const f of audit.data.findings) {
    console.log(
      `            · ${money(f.disputedAmount).padStart(12)}  ${f.kind.padEnd(20)} ${f.title.slice(0, 60)}`,
    );
  }

  // 4. Benchmark
  const benchmark = await benchmarkPrices(reviewed, audit.data.findings);
  trail.push(trailEntry("Benchmark", benchmark.vendor, benchmark.provenance, benchmark.note));
  console.log(
    `[${badge(benchmark.provenance)}] benchmark  ${benchmark.data.evidence.length} codes priced  (${benchmark.ms}ms)`,
  );

  // 5. Generate
  const doc = await generateDisputeLetter({
    meta: extraction.data.meta,
    lines: reviewed,
    findings: audit.data.findings,
    evidence: benchmark.data.evidence,
    billedTotal: billed,
    disputedTotal: audit.data.totalDisputed,
    reviewer: "Demo Reviewer",
    reviewedCount: flagged.length,
  });
  trail.push(trailEntry("Generation", doc.vendor, doc.provenance, doc.note));
  console.log(
    `[${badge(doc.provenance)}] generate   ${doc.data.branchesTaken.length} template branches, ` +
      `${Math.round(Buffer.from(doc.data.pdfBase64, "base64").length / 1024)}KB PDF  (${doc.ms}ms)`,
  );
  for (const b of doc.data.branchesTaken) {
    console.log(`            · ${b}`);
  }

  // 6. Request signature — the agent's last unilateral act
  const sig = await requestSignature({
    documentId: doc.data.documentId,
    title: doc.data.title,
    pdfBase64: doc.data.pdfBase64,
    signerName: extraction.data.meta.patientName,
    signerEmail: "patient@example.com",
  });
  trail.push(trailEntry("Signature requested", sig.vendor, sig.provenance, sig.note));
  console.log(
    `[${badge(sig.provenance)}] sign-req   envelope ${sig.data.envelopeId.slice(0, 20)}… status=${sig.data.status}  (${sig.ms}ms)`,
  );

  if (sig.data.status !== "awaiting_signature") {
    throw new Error(`agent produced status ${sig.data.status} — it must never sign on its own`);
  }

  // 7. The boundary must refuse an agent-initiated signature.
  let refused = false;
  try {
    await applySignature({
      envelopeId: sig.data.envelopeId,
      pdfBase64: doc.data.pdfBase64,
      signerName: extraction.data.meta.patientName,
      typedSignature: "Agent",
      auditLines: [],
      provider: sig.data.provider,
      humanConfirmed: false,
    });
  } catch {
    refused = true;
  }
  if (!refused) throw new Error("SIGNING BOUNDARY BREACHED: unconfirmed signature succeeded");
  console.log(`[BOUNDARY] refused    unconfirmed signature rejected, as designed`);

  // 8. Human signs
  const signed = await applySignature({
    envelopeId: sig.data.envelopeId,
    pdfBase64: doc.data.pdfBase64,
    signerName: extraction.data.meta.patientName,
    typedSignature: extraction.data.meta.patientName,
    auditLines: formatTrail(trail),
    provider: sig.data.provider,
    humanConfirmed: true,
  });
  console.log(
    `[${badge(signed.provenance)}] sign-apply signed, hash ${signed.data.signature.documentHash.slice(0, 16)}…  (${signed.ms}ms)`,
  );

  // 9. A replayed signature must fail — the intent is spent.
  let replayBlocked = false;
  try {
    await applySignature({
      envelopeId: sig.data.envelopeId,
      pdfBase64: doc.data.pdfBase64,
      signerName: extraction.data.meta.patientName,
      typedSignature: "Replay",
      auditLines: [],
      provider: sig.data.provider,
      humanConfirmed: true,
    });
  } catch {
    replayBlocked = true;
  }
  if (!replayBlocked) throw new Error("replayed signature succeeded — intent token not consumed");
  console.log(`[BOUNDARY] replay     second signature on a spent envelope rejected`);

  if (writePdf) {
    mkdirSync("tmp-artifacts", { recursive: true });
    const out = "tmp-artifacts/signed-dispute-letter.pdf";
    writeFileSync(out, Buffer.from(signed.data.signedPdfBase64, "base64"));
    console.log(`\n  wrote ${out}`);
  }

  const corrected = billed - audit.data.totalDisputed;
  console.log(
    `\n  RESULT  billed ${money(billed)} → corrected ${money(corrected)} ` +
      `— saved ${money(audit.data.totalDisputed)} (${((audit.data.totalDisputed / billed) * 100).toFixed(1)}%)`,
  );

  return { billed, disputed: audit.data.totalDisputed };
}

async function main() {
  console.log("BillShield pipeline smoke test");
  const results = [];
  for (const sample of SAMPLE_BILLS) {
    results.push(await runOne(sample.id, sample.id === "er-wrist"));
  }

  console.log(`\n${"=".repeat(78)}`);
  console.log("  All samples passed.");
  for (const [i, r] of results.entries()) {
    console.log(
      `  ${SAMPLE_BILLS[i].label.padEnd(24)} ${money(r.billed).padStart(13)} → saved ${money(r.disputed).padStart(13)}`,
    );
  }
  console.log("=".repeat(78));
}

main().catch((err) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
