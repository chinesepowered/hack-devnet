import { FINDING_LABEL, type BillMeta, type Finding, type LineItem, type PriceEvidence } from "./types";

/**
 * The dispute letter template.
 *
 * This is deliberately not mail-merge. The letter branches on what the audit
 * actually found (a bill with no pricing findings gets no pricing section, an
 * insured patient gets a carbon-copy paragraph an uninsured one does not),
 * loops over every finding and every line inside it, and calculates its own
 * subtotals and the corrected balance.
 *
 * The same structured payload is what we POST to Doctavian; this renderer is
 * the offline equivalent, and both report which branches fired so the UI can
 * show the template logic doing real work.
 */

export interface LetterContext {
  meta: BillMeta;
  lines: LineItem[];
  findings: Finding[];
  evidence: PriceEvidence[];
  billedTotal: number;
  disputedTotal: number;
  /** Human who reviewed the low-confidence extractions, if any. */
  reviewer?: string;
  reviewedCount: number;
}

export interface RenderedLetter {
  title: string;
  body: string;
  branchesTaken: string[];
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function today(): string {
  return new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Build the structured payload a template engine consumes. */
export function buildLetterPayload(ctx: LetterContext) {
  const byId = new Map(ctx.lines.map((l) => [l.id, l]));
  const structural = ctx.findings.filter((f) => f.kind !== "price_gouging");
  const pricing = ctx.findings.filter((f) => f.kind === "price_gouging");

  return {
    letter_date: today(),
    patient: {
      name: ctx.meta.patientName,
      account_number: ctx.meta.accountNumber,
      insurer: ctx.meta.insurer ?? null,
      policy_number: ctx.meta.policyNumber ?? null,
      is_insured: Boolean(ctx.meta.insurer),
    },
    provider: {
      name: ctx.meta.provider,
      address: ctx.meta.providerAddress,
    },
    service_date: ctx.meta.serviceDate,
    statement_date: ctx.meta.statementDate,
    totals: {
      billed: ctx.billedTotal,
      disputed: ctx.disputedTotal,
      corrected: Math.max(0, ctx.billedTotal - ctx.disputedTotal),
      structural_disputed: structural.reduce((s, f) => s + f.disputedAmount, 0),
      pricing_disputed: pricing.reduce((s, f) => s + f.disputedAmount, 0),
      percent_disputed:
        ctx.billedTotal > 0 ? (ctx.disputedTotal / ctx.billedTotal) * 100 : 0,
    },
    review: {
      reviewer: ctx.reviewer ?? null,
      reviewed_count: ctx.reviewedCount,
      had_human_review: ctx.reviewedCount > 0,
    },
    findings: ctx.findings.map((f) => ({
      kind: f.kind,
      kind_label: FINDING_LABEL[f.kind],
      severity: f.severity,
      title: f.title,
      rationale: f.rationale,
      citation: f.citation,
      confidence: f.confidence,
      disputed_amount: f.disputedAmount,
      lines: f.lineIds
        .map((id) => byId.get(id))
        .filter((l): l is LineItem => Boolean(l))
        .map((l) => ({
          code: l.code,
          code_system: l.codeSystem,
          description: l.description,
          units: l.units,
          charged: l.charged,
          date_of_service: l.dateOfService,
        })),
    })),
    price_evidence: ctx.evidence.map((e) => ({
      code: e.code,
      description: e.description,
      charged: e.charged,
      reference_rate: e.referenceRate,
      market_median: e.marketMedian,
      markup_multiple: e.markupMultiple,
      sources: e.sources,
    })),
  };
}

export function renderLetter(ctx: LetterContext): RenderedLetter {
  const p = buildLetterPayload(ctx);
  const branches: string[] = [];
  const out: string[] = [];

  const structural = ctx.findings.filter((f) => f.kind !== "price_gouging");
  const pricing = ctx.findings.filter((f) => f.kind === "price_gouging");
  const needsRecords = ctx.findings.filter((f) => f.confidence < 0.7);

  // --- Address block --------------------------------------------------------
  out.push(
    [
      p.letter_date,
      "",
      "Patient Financial Services",
      p.provider.name,
      p.provider.address,
      "",
      `RE: Formal dispute of charges — account ${p.patient.account_number}`,
      `Patient: ${p.patient.name}`,
      `Date of service: ${p.service_date}`,
      `Statement date: ${p.statement_date}`,
      p.patient.is_insured
        ? `Insurer: ${p.patient.insurer} — policy ${p.patient.policy_number}`
        : "Coverage: self-pay",
    ].join("\n"),
  );
  branches.push(
    p.patient.is_insured
      ? "patient.is_insured → included insurer and policy in the header"
      : "patient.is_insured = false → rendered self-pay header variant",
  );

  // --- Opening --------------------------------------------------------------
  out.push("To the billing department,");

  out.push(
    `I am writing to formally dispute charges on the statement referenced above. The statement bills ` +
      `${money(p.totals.billed)} for services on ${p.service_date}. A line-by-line review against published ` +
      `coding rules and reference rates identifies ${money(p.totals.disputed)} in charges that are duplicated, ` +
      `improperly unbundled, unsupported by the services rendered, or priced substantially above the ` +
      `published rate for the same code. That is ${p.totals.percent_disputed.toFixed(1)}% of the statement.`,
  );

  out.push(
    `I am requesting a corrected statement in the amount of ${money(p.totals.corrected)}, together with the ` +
      `itemized documentation identified below. This letter is sent in good faith and I am prepared to pay ` +
      `promptly whatever balance survives that correction.`,
  );

  // --- Human review branch --------------------------------------------------
  if (p.review.had_human_review) {
    branches.push(
      `review.had_human_review → added the verification paragraph (${p.review.reviewed_count} field(s) confirmed by ${p.review.reviewer})`,
    );
    out.push(
      `Each line item below was extracted from your own statement and independently verified. ` +
        `${p.review.reviewed_count} field${p.review.reviewed_count === 1 ? "" : "s"} where the extraction was ` +
        `not certain ${p.review.reviewed_count === 1 ? "was" : "were"} reviewed and confirmed by ` +
        `${p.review.reviewer} before this letter was prepared. A complete processing record, including that ` +
        `review step, is attached.`,
    );
  } else {
    branches.push("review.had_human_review = false → verification paragraph omitted");
  }

  // --- Structural findings loop --------------------------------------------
  if (structural.length > 0) {
    branches.push(
      `findings where kind ≠ price_gouging → looped ${structural.length} coding/documentation item(s)`,
    );
    out.push("SECTION 1 - CODING AND DOCUMENTATION ERRORS");
    out.push(
      `The following ${structural.length} item${structural.length === 1 ? "" : "s"} represent errors in how ` +
        `the claim was coded rather than disagreements about price. Together they account for ` +
        `${money(p.totals.structural_disputed)}.`,
    );

    structural.forEach((f, i) => {
      const lines = f.lineIds
        .map((id) => ctx.lines.find((l) => l.id === id))
        .filter((l): l is LineItem => Boolean(l));

      const detail = lines
        .map(
          (l) =>
            `      ${l.code} (${l.codeSystem})  ${l.description}  —  ${l.units} unit${l.units === 1 ? "" : "s"}  —  ${money(l.charged)}`,
        )
        .join("\n");

      out.push(
        `${i + 1}. ${FINDING_LABEL[f.kind].toUpperCase()} — ${money(f.disputedAmount)}\n` +
          `   ${f.title}\n\n` +
          `   Charges at issue:\n${detail}\n\n` +
          `   ${f.rationale}\n\n` +
          `   Authority: ${f.citation}`,
      );
    });
  } else {
    branches.push("no structural findings → Section 1 omitted entirely");
  }

  // --- Pricing findings loop, with evidence table --------------------------
  if (pricing.length > 0) {
    branches.push(
      `findings where kind = price_gouging → rendered Section 2 with ${pricing.length} priced item(s)`,
    );
    const sectionNo = structural.length > 0 ? 2 : 1;
    out.push(`SECTION ${sectionNo} - CHARGES ABOVE PUBLISHED REFERENCE RATES`);
    out.push(
      `The following charges are priced far above the published rate for the identical code. ` +
        `The comparison below uses the Medicare fee schedule as the reference and the prevailing market ` +
        `price for the same service in this region. Together these account for ` +
        `${money(p.totals.pricing_disputed)}.`,
    );

    pricing.forEach((f, i) => {
      const ev = ctx.evidence.find((e) => f.lineIds.includes(e.lineId));
      let block = `${i + 1}. ${f.title} — ${money(f.disputedAmount)}\n\n   ${f.rationale}`;
      if (ev) {
        branches.push(`price_evidence present for ${ev.code} → embedded market comparison`);
        block +=
          `\n\n   Comparison for ${ev.code}:\n` +
          `      Billed on this statement    ${money(ev.charged)}\n` +
          `      Published reference rate    ${money(ev.referenceRate)}\n` +
          `      Prevailing market price     ${money(ev.marketMedian)}\n` +
          `      Markup over reference       ${ev.markupMultiple.toFixed(1)}x`;
        if (ev.sources.length > 0) {
          block +=
            `\n\n   Market prices observed:\n` +
            ev.sources
              .slice(0, 4)
              .map((s) => `      ${money(s.price)}  —  ${s.label}`)
              .join("\n");
        }
      }
      block += `\n\n   Authority: ${f.citation}`;
      out.push(block);
    });
  } else {
    branches.push("no pricing findings → Section 2 omitted");
  }

  // --- Records request branch ----------------------------------------------
  if (needsRecords.length > 0) {
    branches.push(
      `findings with confidence < 0.70 → added an itemized records request for ${needsRecords.length} item(s)`,
    );
    out.push("RECORDS REQUESTED");
    out.push(
      `For the following items I am requesting the underlying documentation before any payment is made. ` +
        `This is a request under the Fair Credit Billing Act and, where applicable, my right of access to ` +
        `my own medical record:`,
    );
    out.push(
      needsRecords
        .map((f, i) => `   ${i + 1}. ${f.title} — the order, the report, and the signed documentation.`)
        .join("\n"),
    );
  }

  // --- Summary calculation table -------------------------------------------
  out.push("SUMMARY");
  const summaryRows: Array<[string, string]> = [
    ["Total billed", money(p.totals.billed)],
    ...(structural.length > 0
      ? ([["Less: coding and documentation errors", `(${money(p.totals.structural_disputed)})`]] as Array<
          [string, string]
        >)
      : []),
    ...(pricing.length > 0
      ? ([["Less: charges above reference rates", `(${money(p.totals.pricing_disputed)})`]] as Array<
          [string, string]
        >)
      : []),
    ["Corrected balance requested", money(p.totals.corrected)],
  ];
  const labelW = Math.max(...summaryRows.map(([l]) => l.length)) + 4;
  out.push(
    summaryRows.map(([l, v]) => `   ${l.padEnd(labelW)}${v.padStart(14)}`).join("\n"),
  );

  // --- Closing, with an escalation branch for large disputes ---------------
  out.push(
    `Please provide a corrected, itemized statement within 30 days. I am keeping a complete record of this ` +
      `dispute, including the processing trail attached to this letter.`,
  );

  if (p.totals.percent_disputed > 40) {
    branches.push("totals.percent_disputed > 40 → added regulatory escalation paragraph");
    out.push(
      `Because the disputed amount exceeds 40% of the statement, please treat this as a formal billing ` +
        `dispute rather than a routine inquiry. Pending its resolution, I ask that this account not be ` +
        `referred to collections or reported to any consumer reporting agency, consistent with 15 U.S.C. ` +
        `§1666(d). If we cannot resolve this directly, I intend to file with the state insurance ` +
        `commissioner and the Consumer Financial Protection Bureau.`,
    );
  } else {
    branches.push("totals.percent_disputed <= 40 → standard closing, no escalation paragraph");
  }

  if (p.patient.is_insured) {
    branches.push("patient.is_insured → added carbon copy to insurer");
    out.push(
      `A copy of this letter is being sent to ${p.patient.insurer} under policy ${p.patient.policy_number}, ` +
        `as these charges bear on the claim submitted on my behalf.`,
    );
  }

  out.push(`Respectfully,\n\n\n${p.patient.name}\nAccount ${p.patient.account_number}`);

  return {
    title: `Formal billing dispute — account ${p.patient.account_number}`,
    body: out.join("\n\n"),
    branchesTaken: branches,
  };
}
