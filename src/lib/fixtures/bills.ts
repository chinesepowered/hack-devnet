import type { BillMeta, ExtractionResult, LineItem } from "../types";

/**
 * Sample bills for the demo.
 *
 * Each one is a plausible hospital statement containing real, commonly
 * documented billing errors — a duplicated visit code, a panel billed
 * alongside its own components, supplies that belong in the facility fee.
 * Nothing here is flagged in advance: the audit engine has to find it.
 */

export interface SampleBill {
  id: string;
  label: string;
  blurb: string;
  /** Emoji used as the card glyph. */
  glyph: string;
  extraction: ExtractionResult;
  /** Plain-text rendering, used as the OCR payload when we call a live parser. */
  rawText: string;
}

function line(
  id: string,
  code: string,
  codeSystem: LineItem["codeSystem"],
  description: string,
  units: number,
  charged: number,
  dateOfService: string,
  confidence: number,
): LineItem {
  return {
    id,
    code,
    codeSystem,
    description,
    units,
    charged,
    dateOfService,
    confidence,
    needsReview: confidence < 0.9,
  };
}

function renderRawText(meta: BillMeta, lines: LineItem[]): string {
  const header = [
    meta.provider,
    meta.providerAddress,
    "",
    `PATIENT: ${meta.patientName}`,
    `ACCOUNT: ${meta.accountNumber}`,
    `DATE OF SERVICE: ${meta.serviceDate}`,
    `STATEMENT DATE: ${meta.statementDate}`,
    meta.insurer ? `INSURER: ${meta.insurer}  POLICY: ${meta.policyNumber ?? "N/A"}` : "",
    "",
    "CODE      QTY   DESCRIPTION                                        CHARGE",
    "-".repeat(78),
  ]
    .filter(Boolean)
    .join("\n");

  const body = lines
    .map(
      (l) =>
        `${l.code.padEnd(9)} ${String(l.units).padStart(3)}   ${l.description.slice(0, 48).padEnd(48)} ${l.charged.toFixed(2).padStart(10)}`,
    )
    .join("\n");

  const footer = [
    "-".repeat(78),
    `${"TOTAL CHARGES".padEnd(62)}${meta.statedTotal.toFixed(2).padStart(16)}`,
  ].join("\n");

  return [header, body, footer].join("\n");
}

// ---------------------------------------------------------------------------
// Sample 1 — Emergency department visit for a wrist fracture
// ---------------------------------------------------------------------------

const erMeta: BillMeta = {
  provider: "St. Meridian Regional Medical Center",
  providerAddress: "4400 Harborview Parkway, Santa Clara, CA 95054",
  patientName: "Dana Okafor",
  accountNumber: "SMR-2026-448193",
  serviceDate: "2026-07-14",
  statementDate: "2026-08-02",
  insurer: "Meridian Health Plan (PPO)",
  policyNumber: "MHP-8842019-03",
  statedTotal: 18400,
};

const erLines: LineItem[] = [
  line("er-1", "0450", "REV", "EMERG ROOM LEVEL IV FACILITY", 1, 2764, "2026-07-14", 0.97),
  line("er-2", "99285", "CPT", "Emergency dept visit, highest complexity", 1, 3200, "2026-07-14", 0.96),
  // Same visit code billed a second time on the same date — a classic duplicate.
  line("er-3", "99285", "CPT", "Emergency dept visit, highest complexity", 1, 3200, "2026-07-14", 0.94),
  // A third, lower-level E/M for a single encounter: nobody was seen twice.
  line("er-4", "99283", "CPT", "ED PROF FEE LVL 3", 1, 1240, "2026-07-14", 0.88),
  line("er-5", "80053", "CPT", "Comprehensive metabolic panel", 1, 485, "2026-07-14", 0.95),
  // The next three are components of the panel above, billed again separately.
  line("er-6", "82565", "CPT", "Creatinine, blood", 1, 185, "2026-07-14", 0.93),
  line("er-7", "82947", "CPT", "Glucose, quantitative", 1, 175, "2026-07-14", 0.92),
  line("er-8", "84295", "CPT", "Sodium, serum", 1, 165, "2026-07-14", 0.91),
  line("er-9", "84443", "CPT", "Thyroid stimulating hormone", 1, 210, "2026-07-14", 0.9),
  line("er-10", "86900", "CPT", "TYPE AND SCREEN", 1, 210, "2026-07-14", 0.86),
  line("er-11", "36415", "CPT", "Routine venipuncture", 1, 95, "2026-07-14", 0.96),
  line("er-12", "71046", "CPT", "Chest X-ray, 2 views", 1, 890, "2026-07-14", 0.95),
  line("er-13", "73110", "CPT", "X-ray, wrist, complete, 3+ views", 1, 760, "2026-07-14", 0.97),
  line("er-14", "29125", "CPT", "Application of short arm splint", 1, 1450, "2026-07-14", 0.96),
  line("er-15", "96374", "CPT", "IV push, single drug, initial", 1, 780, "2026-07-14", 0.94),
  // Eight liters of saline for an outpatient wrist injury: a quantity error.
  line("er-16", "J7030", "HCPCS", "IV FLUID NS 1000ML BAG", 8, 1096, "2026-07-14", 0.89),
  line("er-17", "J1885", "HCPCS", "Ketorolac tromethamine, per 15 mg", 2, 195, "2026-07-14", 0.93),
  line("er-18", "A4550", "HCPCS", "Surgical tray", 1, 410, "2026-07-14", 0.95),
  line("er-19", "99070", "CPT", "MISC SUPPLY CHG", 1, 890, "2026-07-14", 0.87),
];

// ---------------------------------------------------------------------------
// Sample 2 — Vaginal delivery with epidural
// ---------------------------------------------------------------------------

const birthMeta: BillMeta = {
  provider: "Bayside Women's & Children's Hospital",
  providerAddress: "1290 Cedar Point Road, San Jose, CA 95134",
  patientName: "Priya Raman",
  accountNumber: "BWC-2026-771205",
  serviceDate: "2026-06-03",
  statementDate: "2026-06-28",
  insurer: "Northstar Mutual (HMO)",
  policyNumber: "NS-4471903",
  statedTotal: 27850,
};

const birthLines: LineItem[] = [
  line("bd-1", "0720", "REV", "Labor room / delivery services", 1, 8400, "2026-06-03", 0.97),
  line("bd-2", "59400", "CPT", "Obstetric care, vaginal delivery, global", 1, 9200, "2026-06-03", 0.96),
  // The global code above already includes the delivery — billing it again is unbundling.
  line("bd-3", "59409", "CPT", "Vaginal delivery only", 1, 4100, "2026-06-03", 0.9),
  line("bd-4", "01967", "CPT", "Neuraxial labor analgesia (epidural)", 1, 2850, "2026-06-03", 0.95),
  line("bd-5", "85025", "CPT", "Complete blood count with differential", 2, 310, "2026-06-03", 0.94),
  line("bd-6", "80053", "CPT", "Comprehensive metabolic panel", 1, 420, "2026-06-03", 0.93),
  line("bd-7", "82947", "CPT", "GLUC RANDOM", 1, 160, "2026-06-03", 0.88),
  line("bd-8", "J0690", "HCPCS", "Cefazolin sodium injection, 500 mg", 3, 285, "2026-06-03", 0.92),
  line("bd-9", "J7030", "HCPCS", "Normal saline infusion, 1000 cc", 4, 548, "2026-06-03", 0.91),
  line("bd-10", "99070", "CPT", "OB SUPPLY PACK", 1, 1240, "2026-06-03", 0.86),
  line("bd-11", "0270", "REV", "Medical/surgical supplies, general", 1, 337, "2026-06-03", 0.9),
];

// ---------------------------------------------------------------------------
// Sample 3 — Outpatient knee arthroscopy
// ---------------------------------------------------------------------------

const kneeMeta: BillMeta = {
  provider: "Pacific Orthopedic Surgery Center",
  providerAddress: "77 Innovation Drive, Sunnyvale, CA 94089",
  patientName: "Marcus Delgado",
  accountNumber: "POS-2026-330871",
  serviceDate: "2026-05-19",
  statementDate: "2026-06-11",
  insurer: "Cascade Benefit Group (PPO)",
  policyNumber: "CBG-99120044",
  statedTotal: 42120,
};

const kneeLines: LineItem[] = [
  line("kn-1", "0360", "REV", "Operating room services", 1, 14800, "2026-05-19", 0.97),
  line("kn-2", "29881", "CPT", "Knee arthroscopy with meniscectomy", 1, 11400, "2026-05-19", 0.96),
  // Chondroplasty in the same compartment is bundled into the meniscectomy.
  line("kn-3", "29877", "CPT", "Knee arthroscopy, chondroplasty", 1, 6200, "2026-05-19", 0.89),
  line("kn-4", "01402", "CPT", "Anesthesia for knee procedure", 1, 3850, "2026-05-19", 0.95),
  line("kn-5", "99152", "CPT", "CONSC SEDATION 15M", 1, 620, "2026-05-19", 0.87),
  line("kn-6", "72148", "CPT", "MRI L-SPINE W/O CONT", 1, 2400, "2026-05-19", 0.84),
  line("kn-7", "85025", "CPT", "Complete blood count with differential", 1, 240, "2026-05-19", 0.94),
  line("kn-8", "J0690", "HCPCS", "Cefazolin sodium injection, 500 mg", 2, 190, "2026-05-19", 0.93),
  line("kn-9", "J7030", "HCPCS", "Normal saline infusion, 1000 cc", 3, 411, "2026-05-19", 0.9),
  line("kn-10", "A4550", "HCPCS", "Surgical tray", 2, 820, "2026-05-19", 0.95),
  line("kn-11", "99070", "CPT", "OR SUPPLY CHG MISC", 1, 1189, "2026-05-19", 0.86),
];

function build(
  id: string,
  label: string,
  blurb: string,
  glyph: string,
  meta: BillMeta,
  lines: LineItem[],
  documentConfidence: number,
  pageCount: number,
): SampleBill {
  return {
    id,
    label,
    blurb,
    glyph,
    extraction: { meta, lines, documentConfidence, pageCount },
    rawText: renderRawText(meta, lines),
  };
}

export const SAMPLE_BILLS: SampleBill[] = [
  build(
    "er-wrist",
    "Emergency room visit",
    "A fall on a hiking trail. One night in the ER, a splinted wrist, and a bill with a duplicated visit code.",
    "🚑",
    erMeta,
    erLines,
    0.93,
    3,
  ),
  build(
    "childbirth",
    "Childbirth",
    "A routine vaginal delivery billed both as a global package and line by line.",
    "👶",
    birthMeta,
    birthLines,
    0.92,
    4,
  ),
  build(
    "knee-surgery",
    "Knee surgery",
    "Outpatient arthroscopy with an MRI of the wrong body part attached to the claim.",
    "🦵",
    kneeMeta,
    kneeLines,
    0.91,
    5,
  ),
];

export function getSampleBill(id: string): SampleBill | undefined {
  return SAMPLE_BILLS.find((b) => b.id === id);
}

export const DEFAULT_SAMPLE_ID = "er-wrist";
