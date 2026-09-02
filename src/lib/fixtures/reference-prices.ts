/**
 * Published reference rates by procedure code, in dollars per unit.
 *
 * These approximate the Medicare Physician Fee Schedule / Clinical Lab Fee
 * Schedule national averages — the number a hospital's own billing department
 * recognizes as the floor of a defensible price. BillShield uses them two ways:
 *
 *   1. As the anchor for every markup calculation.
 *   2. As the offline fallback when live market pricing is unavailable.
 *
 * `bundled: true` marks codes that payers consider included in a facility fee
 * and therefore not separately billable.
 */

export interface ReferenceEntry {
  code: string;
  description: string;
  /** Medicare-style allowed amount per unit, USD. */
  referenceRate: number;
  /** Typical cash-pay market price per unit, USD — the fallback for SerpApi. */
  marketMedian: number;
  /** Plausible maximum units for a single encounter; used for quantity checks. */
  maxUnits?: number;
  bundled?: boolean;
  /** Component codes contained within this panel — used for unbundling checks. */
  components?: string[];
  /** Evaluation & management level, if this is an E/M code. */
  emLevel?: number;
  /** The next level down, used when we contend a visit was upcoded. */
  downcodeTo?: string;
}

export const REFERENCE_PRICES: Record<string, ReferenceEntry> = {
  // --- Emergency department evaluation & management ---
  "99281": { code: "99281", description: "Emergency dept visit, straightforward", referenceRate: 25, marketMedian: 180, emLevel: 1 },
  "99282": { code: "99282", description: "Emergency dept visit, low complexity", referenceRate: 48, marketMedian: 330, emLevel: 2, downcodeTo: "99281" },
  "99283": { code: "99283", description: "Emergency dept visit, moderate complexity", referenceRate: 80, marketMedian: 620, emLevel: 3, downcodeTo: "99282" },
  "99284": { code: "99284", description: "Emergency dept visit, high complexity", referenceRate: 145, marketMedian: 1180, emLevel: 4, downcodeTo: "99283" },
  "99285": { code: "99285", description: "Emergency dept visit, highest complexity", referenceRate: 215, marketMedian: 1950, emLevel: 5, downcodeTo: "99284" },

  // --- Office / inpatient E/M ---
  "99213": { code: "99213", description: "Office visit, established patient, low", referenceRate: 92, marketMedian: 165, emLevel: 3 },
  "99214": { code: "99214", description: "Office visit, established patient, moderate", referenceRate: 131, marketMedian: 245, emLevel: 4, downcodeTo: "99213" },
  "99215": { code: "99215", description: "Office visit, established patient, high", referenceRate: 184, marketMedian: 360, emLevel: 5, downcodeTo: "99214" },
  "99223": { code: "99223", description: "Initial hospital care, high complexity", referenceRate: 211, marketMedian: 690, emLevel: 3, downcodeTo: "99222" },
  "99222": { code: "99222", description: "Initial hospital care, moderate complexity", referenceRate: 144, marketMedian: 470, emLevel: 2 },
  "99232": { code: "99232", description: "Subsequent hospital care, moderate", referenceRate: 78, marketMedian: 240, emLevel: 2 },

  // --- Laboratory panels and their components ---
  "80053": {
    code: "80053",
    description: "Comprehensive metabolic panel",
    referenceRate: 14.5,
    marketMedian: 49,
    components: ["82565", "82947", "84295", "84132", "82310", "84450", "84460", "82040", "84155", "82247"],
  },
  "80048": {
    code: "80048",
    description: "Basic metabolic panel",
    referenceRate: 11.6,
    marketMedian: 39,
    components: ["82565", "82947", "84295", "84132", "82310"],
  },
  "80061": {
    code: "80061",
    description: "Lipid panel",
    referenceRate: 18.4,
    marketMedian: 55,
    components: ["82465", "83718", "84478"],
  },
  "85025": { code: "85025", description: "Complete blood count with differential", referenceRate: 10.6, marketMedian: 38 },
  "82565": { code: "82565", description: "Creatinine, blood", referenceRate: 7.0, marketMedian: 22 },
  "82947": { code: "82947", description: "Glucose, quantitative", referenceRate: 5.5, marketMedian: 18 },
  "84295": { code: "84295", description: "Sodium, serum", referenceRate: 8.0, marketMedian: 24 },
  "84132": { code: "84132", description: "Potassium, serum", referenceRate: 7.5, marketMedian: 23 },
  "82310": { code: "82310", description: "Calcium, total", referenceRate: 7.2, marketMedian: 21 },
  "84443": { code: "84443", description: "Thyroid stimulating hormone", referenceRate: 23.0, marketMedian: 68 },
  "86900": { code: "86900", description: "Blood typing, ABO", referenceRate: 12.0, marketMedian: 35 },
  "36415": { code: "36415", description: "Routine venipuncture", referenceRate: 3.0, marketMedian: 15, maxUnits: 2 },

  // --- Imaging ---
  "71046": { code: "71046", description: "Chest X-ray, 2 views", referenceRate: 32.0, marketMedian: 145, maxUnits: 2 },
  "73110": { code: "73110", description: "X-ray, wrist, complete, 3+ views", referenceRate: 34.0, marketMedian: 155, maxUnits: 2 },
  "72148": { code: "72148", description: "MRI lumbar spine without contrast", referenceRate: 226.0, marketMedian: 750, maxUnits: 1 },
  "74177": { code: "74177", description: "CT abdomen and pelvis with contrast", referenceRate: 302.0, marketMedian: 990, maxUnits: 1 },
  "76700": { code: "76700", description: "Ultrasound, abdomen, complete", referenceRate: 96.0, marketMedian: 310, maxUnits: 1 },

  // --- Procedures and administration ---
  "96374": { code: "96374", description: "IV push, single drug, initial", referenceRate: 37.0, marketMedian: 145, maxUnits: 1 },
  "96375": { code: "96375", description: "IV push, each additional drug", referenceRate: 17.0, marketMedian: 70, maxUnits: 4 },
  "96360": { code: "96360", description: "IV hydration, initial 31 min to 1 hr", referenceRate: 33.0, marketMedian: 130, maxUnits: 1 },
  "29125": { code: "29125", description: "Application of short arm splint", referenceRate: 75.0, marketMedian: 245, maxUnits: 1 },
  "12001": { code: "12001", description: "Simple repair of superficial wound", referenceRate: 118.0, marketMedian: 340, maxUnits: 1 },
  "59400": { code: "59400", description: "Obstetric care, vaginal delivery, global", referenceRate: 2265.0, marketMedian: 5400, maxUnits: 1 },
  "59409": { code: "59409", description: "Vaginal delivery only", referenceRate: 1128.0, marketMedian: 2900, maxUnits: 1 },
  "01967": { code: "01967", description: "Neuraxial labor analgesia (epidural)", referenceRate: 456.0, marketMedian: 1650, maxUnits: 1 },
  "29881": { code: "29881", description: "Knee arthroscopy with meniscectomy", referenceRate: 542.0, marketMedian: 3900, maxUnits: 1 },
  "29877": { code: "29877", description: "Knee arthroscopy, chondroplasty", referenceRate: 421.0, marketMedian: 2600, maxUnits: 1 },
  "01402": { code: "01402", description: "Anesthesia for knee arthroplasty", referenceRate: 388.0, marketMedian: 1400, maxUnits: 1 },
  "99152": { code: "99152", description: "Moderate sedation, initial 15 min", referenceRate: 28.0, marketMedian: 120, maxUnits: 1 },

  // --- Drugs and supplies ---
  "J7030": { code: "J7030", description: "Normal saline infusion, 1000 cc", referenceRate: 1.5, marketMedian: 8, maxUnits: 4 },
  "J2405": { code: "J2405", description: "Ondansetron injection, per 1 mg", referenceRate: 0.28, marketMedian: 2, maxUnits: 8 },
  "J1885": { code: "J1885", description: "Ketorolac tromethamine, per 15 mg", referenceRate: 0.62, marketMedian: 4, maxUnits: 4 },
  "J0690": { code: "J0690", description: "Cefazolin sodium injection, 500 mg", referenceRate: 0.9, marketMedian: 6, maxUnits: 6 },
  "A4550": { code: "A4550", description: "Surgical tray", referenceRate: 0, marketMedian: 0, bundled: true },
  "99070": { code: "99070", description: "Supplies and materials, unspecified", referenceRate: 0, marketMedian: 0, bundled: true },
  "A9270": { code: "A9270", description: "Non-covered item or service", referenceRate: 0, marketMedian: 0, bundled: true },

  // --- Revenue codes (facility fees) ---
  "0450": { code: "0450", description: "Emergency room, general facility fee", referenceRate: 385.0, marketMedian: 1450, maxUnits: 1 },
  "0250": { code: "0250", description: "Pharmacy, general", referenceRate: 0, marketMedian: 0, bundled: true },
  "0270": { code: "0270", description: "Medical/surgical supplies, general", referenceRate: 0, marketMedian: 0, bundled: true },
  "0360": { code: "0360", description: "Operating room services", referenceRate: 1420.0, marketMedian: 4800, maxUnits: 1 },
  "0720": { code: "0720", description: "Labor room / delivery", referenceRate: 1180.0, marketMedian: 3900, maxUnits: 1 },
};

/**
 * A widely used settlement anchor: payers and patient-advocacy groups treat
 * roughly 300% of the Medicare rate as a defensible commercial price. Charges
 * above that are what we contend down to.
 */
/**
 * Markup tolerance scales with what the service is.
 *
 * A saline bag marked up 90× is indefensible. A surgical procedure at 10× the
 * professional fee schedule is ordinary hospital chargemaster behaviour,
 * because the charge bundles facility costs the fee schedule does not cover.
 * Flagging both at the same threshold would make the audit look like it just
 * disputes everything, which is exactly the objection a billing department
 * reaches for first. So the bar rises with the reference rate.
 */
export interface PricingTier {
  /** Applies when the reference rate per unit is below this. */
  upTo: number;
  /** Charge must exceed this multiple of reference before we raise a finding. */
  threshold: number;
  /** The multiple we contend the charge down to. */
  fairMultiple: number;
}

export const PRICING_TIERS: PricingTier[] = [
  // Supplies, drugs, routine labs — no defensible reason for a large markup.
  { upTo: 50, threshold: 8, fairMultiple: 3.0 },
  // Imaging and minor procedures — some facility overhead is legitimate.
  { upTo: 500, threshold: 8, fairMultiple: 3.5 },
  // Major procedures and facility fees — the charge genuinely carries more.
  { upTo: Infinity, threshold: 12, fairMultiple: 4.0 },
];

export function tierFor(referenceRate: number): PricingTier {
  return PRICING_TIERS.find((t) => referenceRate < t.upTo) ?? PRICING_TIERS[PRICING_TIERS.length - 1];
}

/**
 * No single pricing finding may ask for more than this share of the line.
 * A dispute letter asks for a reduction toward a benchmark; one that asks a
 * provider to write off 95% of a charge gets filed in the bin.
 */
export const MAX_PRICING_DISPUTE_SHARE = 0.6;

export function lookupReference(code: string): ReferenceEntry | undefined {
  return REFERENCE_PRICES[code.toUpperCase()] ?? REFERENCE_PRICES[code];
}
