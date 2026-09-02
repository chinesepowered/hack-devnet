import {
  MAX_PRICING_DISPUTE_SHARE,
  lookupReference,
  tierFor,
} from "./fixtures/reference-prices";
import type { AuditResult, Finding, LineItem, Severity } from "./types";

/**
 * The deterministic audit engine.
 *
 * This is BillShield's floor, not its ceiling: it finds structural coding
 * errors from published billing rules alone, with no model in the loop. When a
 * model is reachable it runs on top of these findings and adds the judgement
 * calls a rules engine can't make. When it isn't, the demo — and the dispute
 * letter — still works, and every number still traces to a rule.
 */

/** Procedure bundles: billing the parent already pays for the children. */
const PROCEDURE_BUNDLES: Record<string, { includes: string[]; rule: string }> = {
  "59400": {
    includes: ["59409", "59410", "59425", "59426"],
    rule: "CPT 59400 is a global obstetric package that already includes the delivery itself.",
  },
  "29881": {
    includes: ["29877", "29874"],
    rule: "NCCI edits bundle chondroplasty (29877) into a meniscectomy (29881) performed in the same compartment.",
  },
  "80053": {
    includes: [],
    rule: "A comprehensive metabolic panel already contains each of its component assays.",
  },
};

/** Rough anatomical region per code, used to spot services unrelated to the encounter. */
const BODY_REGION: Record<string, string> = {
  "71046": "thorax",
  "73110": "upper extremity",
  "29125": "upper extremity",
  "72148": "spine",
  "74177": "abdomen",
  "76700": "abdomen",
  "29881": "lower extremity",
  "29877": "lower extremity",
  "01402": "lower extremity",
  "12001": "skin",
  "59400": "obstetric",
  "59409": "obstetric",
  "01967": "obstetric",
};

const IMAGING_CODES = new Set(["71046", "73110", "72148", "74177", "76700"]);

let seq = 0;
function fid(kind: string): string {
  seq += 1;
  return `f-${kind}-${seq}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function severityFor(amount: number): Severity {
  if (amount >= 1000) return "high";
  if (amount >= 250) return "medium";
  return "low";
}

/**
 * Run every rule over the extracted lines.
 *
 * Findings are produced in two passes. The first pass catches structural
 * errors and disputes the full charge; any line it resolves is removed from
 * consideration. The second pass values what remains, and gives each surviving
 * line at most one pricing finding, so nothing is ever disputed twice.
 */
export function runAuditRules(lines: LineItem[]): AuditResult {
  seq = 0;
  const findings: Finding[] = [];
  /** Lines already disputed in full — excluded from all later rules. */
  const resolved = new Set<string>();
  /** Lines that already carry a valuation finding. */
  const valued = new Set<string>();

  const byId = new Map(lines.map((l) => [l.id, l]));
  const available = () => lines.filter((l) => !resolved.has(l.id));

  // -------------------------------------------------------------------------
  // Pass 1a — exact duplicates: same code, same date, same charge
  // -------------------------------------------------------------------------
  const dupeKey = (l: LineItem) => `${l.code}|${l.dateOfService}|${l.charged}|${l.units}`;
  const groups = new Map<string, LineItem[]>();
  for (const l of lines) {
    const k = dupeKey(l);
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    const [kept, ...dupes] = group;
    const amount = round2(dupes.reduce((s, d) => s + d.charged, 0));
    for (const d of dupes) resolved.add(d.id);
    findings.push({
      id: fid("dup"),
      lineIds: dupes.map((d) => d.id),
      kind: "duplicate",
      severity: severityFor(amount),
      title: `${kept.description} billed ${group.length} times on the same date`,
      rationale:
        `Code ${kept.code} appears ${group.length} times for ${kept.dateOfService} at an identical charge of ` +
        `$${kept.charged.toLocaleString()}. A single encounter supports a single charge; the additional ` +
        `${dupes.length === 1 ? "line is a duplicate" : "lines are duplicates"} and should be removed.`,
      disputedAmount: amount,
      citation: "45 CFR 164.501 (accurate billing records); NCCI Policy Manual, Ch. 1 §B",
      confidence: 0.97,
    });
  }

  // -------------------------------------------------------------------------
  // Pass 1b — more than one evaluation & management visit for one encounter
  // -------------------------------------------------------------------------
  const emByDate = new Map<string, LineItem[]>();
  for (const l of available()) {
    const ref = lookupReference(l.code);
    if (ref?.emLevel === undefined) continue;
    emByDate.set(l.dateOfService, [...(emByDate.get(l.dateOfService) ?? []), l]);
  }
  for (const [date, ems] of emByDate) {
    if (ems.length < 2) continue;
    // Keep the highest-level visit; everything else on that date is unsupported.
    const sorted = [...ems].sort(
      (a, b) => (lookupReference(b.code)?.emLevel ?? 0) - (lookupReference(a.code)?.emLevel ?? 0),
    );
    const extras = sorted.slice(1);
    const amount = round2(extras.reduce((s, e) => s + e.charged, 0));
    for (const e of extras) resolved.add(e.id);
    findings.push({
      id: fid("phantom"),
      lineIds: extras.map((e) => e.id),
      kind: "phantom",
      severity: severityFor(amount),
      title: `${ems.length} separate visit charges for a single encounter on ${date}`,
      rationale:
        `Evaluation and management codes ${ems.map((e) => e.code).join(", ")} are all billed for ${date}. ` +
        `One encounter supports one E/M charge — the highest-level code (${sorted[0].code}) — and the remaining ` +
        `${extras.length === 1 ? "charge is not supported" : "charges are not supported"} by a single visit.`,
      disputedAmount: amount,
      citation: "CPT E/M guidelines: one E/M service per patient, per provider, per encounter",
      confidence: 0.93,
    });
  }

  // -------------------------------------------------------------------------
  // Pass 1c — unbundling: a panel or global procedure billed with its parts
  // -------------------------------------------------------------------------
  const presentCodes = new Map<string, LineItem[]>();
  for (const l of available()) {
    presentCodes.set(l.code, [...(presentCodes.get(l.code) ?? []), l]);
  }

  for (const [parentCode, parentLines] of presentCodes) {
    const ref = lookupReference(parentCode);
    const bundle = PROCEDURE_BUNDLES[parentCode];
    const componentCodes = new Set([...(ref?.components ?? []), ...(bundle?.includes ?? [])]);
    if (componentCodes.size === 0) continue;

    const offenders = available().filter(
      (l) => componentCodes.has(l.code) && !resolved.has(l.id),
    );
    if (offenders.length === 0) continue;

    const amount = round2(offenders.reduce((s, o) => s + o.charged, 0));
    for (const o of offenders) resolved.add(o.id);
    findings.push({
      id: fid("unbundle"),
      lineIds: offenders.map((o) => o.id),
      kind: "unbundling",
      severity: severityFor(amount),
      title: `${offenders.length} charge${offenders.length === 1 ? "" : "s"} already included in ${parentLines[0].description}`,
      rationale:
        `${parentLines[0].description} (${parentCode}) is billed on this statement, and ` +
        `${offenders.map((o) => `${o.description} (${o.code})`).join(", ")} ${offenders.length === 1 ? "is" : "are"} ` +
        `billed separately on top of it. ` +
        (bundle?.rule ??
          "The panel's published definition already includes each component assay.") +
        " Billing both is unbundling.",
      disputedAmount: amount,
      citation:
        "National Correct Coding Initiative (NCCI) Policy Manual, Chapter 1 §E — unbundling",
      confidence: 0.95,
    });
  }

  // -------------------------------------------------------------------------
  // Pass 1d — supplies and trays that belong inside the facility fee
  // -------------------------------------------------------------------------
  const bundledSupplies = available().filter((l) => lookupReference(l.code)?.bundled);
  if (bundledSupplies.length > 0) {
    const amount = round2(bundledSupplies.reduce((s, l) => s + l.charged, 0));
    for (const l of bundledSupplies) resolved.add(l.id);
    findings.push({
      id: fid("bundled"),
      lineIds: bundledSupplies.map((l) => l.id),
      kind: "not_covered_bundled",
      severity: severityFor(amount),
      title: "Routine supplies billed separately from the facility fee",
      rationale:
        `${bundledSupplies.map((l) => `${l.description} (${l.code})`).join(", ")} ` +
        `${bundledSupplies.length === 1 ? "is a routine item" : "are routine items"} whose cost is already ` +
        `covered by the facility or procedure fee on this same statement. Payers do not reimburse these as ` +
        `separate line items, and a self-pay patient should not be charged for them either.`,
      disputedAmount: amount,
      citation: "Medicare Claims Processing Manual, Ch. 4 §20.5 — packaged services",
      confidence: 0.91,
    });
  }

  // -------------------------------------------------------------------------
  // Pass 1e — imaging of a body region unrelated to anything else on the bill
  // -------------------------------------------------------------------------
  const treatedRegions = new Set(
    available()
      .filter((l) => !IMAGING_CODES.has(l.code))
      .map((l) => BODY_REGION[l.code])
      .filter(Boolean),
  );
  if (treatedRegions.size > 0) {
    for (const l of available()) {
      if (!IMAGING_CODES.has(l.code)) continue;
      const region = BODY_REGION[l.code];
      if (!region || treatedRegions.has(region)) continue;
      resolved.add(l.id);
      findings.push({
        id: fid("unrelated"),
        lineIds: [l.id],
        kind: "phantom",
        severity: "medium",
        title: `${l.description} appears unrelated to the treated condition`,
        rationale:
          `This encounter treated the ${[...treatedRegions].join(" and ")}, but ${l.description} images the ` +
          `${region}. No other charge on this statement supports a ${region} complaint. We request the imaging ` +
          `order and the radiology report establishing medical necessity, or removal of this charge.`,
        disputedAmount: round2(l.charged),
        citation: "Social Security Act §1862(a)(1)(A) — reasonable and necessary services",
        // Deliberately lower: this one genuinely needs the medical record to settle.
        confidence: 0.55,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Pass 2a — upcoding: top-level E/M contended down one level
  // -------------------------------------------------------------------------
  for (const l of available()) {
    const ref = lookupReference(l.code);
    if (!ref?.emLevel || ref.emLevel < 5 || !ref.downcodeTo) continue;
    const lower = lookupReference(ref.downcodeTo);
    if (!lower || lower.referenceRate <= 0 || ref.referenceRate <= 0) continue;

    // Hold the provider's own price structure constant and re-price at the lower level.
    const fairCharge = round2(l.charged * (lower.referenceRate / ref.referenceRate));
    const amount = round2(l.charged - fairCharge);
    if (amount < 50) continue;

    valued.add(l.id);
    findings.push({
      id: fid("upcode"),
      lineIds: [l.id],
      kind: "upcoding",
      severity: severityFor(amount),
      title: `Highest-level visit code billed without supporting documentation`,
      rationale:
        `${l.description} (${l.code}) is the highest-acuity code in its family and requires documented ` +
        `high-complexity decision-making or a threat to life or bodily function. The services actually billed on ` +
        `this statement are consistent with ${lower.description} (${lower.code}). Re-priced at the provider's own ` +
        `rate structure, the correct charge is $${fairCharge.toLocaleString()}. We request the physician ` +
        `documentation supporting ${l.code}, or a corrected claim.`,
      disputedAmount: amount,
      citation: "CPT E/M documentation guidelines; OIG Work Plan — E/M upcoding",
      confidence: 0.78,
    });
  }

  // -------------------------------------------------------------------------
  // Pass 2b — quantities beyond what one encounter can support
  // -------------------------------------------------------------------------
  for (const l of available()) {
    if (valued.has(l.id)) continue;
    const ref = lookupReference(l.code);
    if (!ref?.maxUnits || l.units <= ref.maxUnits) continue;

    const perUnit = l.charged / l.units;
    const excess = l.units - ref.maxUnits;
    const amount = round2(perUnit * excess);
    if (amount < 25) continue;

    valued.add(l.id);
    findings.push({
      id: fid("qty"),
      lineIds: [l.id],
      kind: "quantity_error",
      severity: severityFor(amount),
      title: `${l.units} units of ${l.description} billed for one encounter`,
      rationale:
        `This statement bills ${l.units} units of ${l.description} (${l.code}) at ` +
        `$${perUnit.toFixed(2)} per unit. A single encounter of this type supports at most ${ref.maxUnits}. ` +
        `We request the administration record documenting all ${l.units} units, or removal of the ${excess} ` +
        `excess unit${excess === 1 ? "" : "s"}.`,
      disputedAmount: amount,
      citation: "Medicare Claims Processing Manual, Ch. 1 §80.3 — medically unlikely edits",
      confidence: 0.84,
    });
  }

  // -------------------------------------------------------------------------
  // Pass 2c — charges far above the published reference rate
  // -------------------------------------------------------------------------
  for (const l of available()) {
    if (valued.has(l.id)) continue;
    const ref = lookupReference(l.code);
    if (!ref || ref.referenceRate <= 0) continue;

    const perUnit = l.charged / Math.max(1, l.units);
    const multiple = perUnit / ref.referenceRate;
    const tier = tierFor(ref.referenceRate);
    if (multiple < tier.threshold) continue;

    const fairCharge = round2(tier.fairMultiple * ref.referenceRate * Math.max(1, l.units));
    // Ask for a reduction toward the benchmark, never for most of the line.
    const capped = Math.min(l.charged - fairCharge, l.charged * MAX_PRICING_DISPUTE_SHARE);
    const amount = round2(capped);
    if (amount < 50) continue;

    const askedFor = round2(l.charged - amount);
    valued.add(l.id);
    findings.push({
      id: fid("price"),
      lineIds: [l.id],
      kind: "price_gouging",
      severity: severityFor(amount),
      title: `${l.description} billed at ${multiple.toFixed(0)}× the published rate`,
      rationale:
        `${l.description} (${l.code}) is billed at $${perUnit.toFixed(2)} per unit against a published ` +
        `reference rate of $${ref.referenceRate.toFixed(2)} — a markup of ${multiple.toFixed(0)}×. ` +
        `Accepting that a hospital charge legitimately carries overhead the fee schedule does not, we are ` +
        `not asking for the reference rate. We ask that this line be adjusted to ` +
        `$${askedFor.toLocaleString()}, which is still ${(askedFor / (ref.referenceRate * Math.max(1, l.units))).toFixed(1)}× ` +
        `the published rate for ${l.units} unit${l.units === 1 ? "" : "s"}.`,
      disputedAmount: amount,
      citation:
        "Hospital Price Transparency Rule, 45 CFR 180.50; CMS published fee schedules",
      confidence: 0.72,
    });
  }

  // Order the letter the way a reader should meet it: biggest, most certain first.
  findings.sort((a, b) => b.disputedAmount - a.disputedAmount);

  const totalDisputed = round2(findings.reduce((s, f) => s + f.disputedAmount, 0));
  const structural = round2(
    findings
      .filter((f) => f.kind !== "price_gouging")
      .reduce((s, f) => s + f.disputedAmount, 0),
  );

  return {
    findings,
    totalDisputed,
    summary:
      findings.length === 0
        ? "No billing errors detected on this statement."
        : `${findings.length} issues found across ${new Set(findings.flatMap((f) => f.lineIds)).size} line items. ` +
          `$${structural.toLocaleString()} of the total is attributable to coding and documentation errors, ` +
          `the remainder to charges above published reference rates.`,
  };
}

/** Convenience accessor used by the letter generator and the UI. */
export function findingLines(finding: Finding, lines: LineItem[]): LineItem[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  return finding.lineIds.map((id) => byId.get(id)).filter((l): l is LineItem => Boolean(l));
}
