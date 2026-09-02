/**
 * Core domain types for BillShield.
 *
 * Every sponsor-facing call returns an `AdapterResult`, which carries not just
 * the data but *where the data came from*. The UI renders that provenance, and
 * the audit trail records it — a judge can always see whether a stage ran on a
 * live vendor API or on the built-in fallback.
 */

export type Provenance = "live" | "fallback" | "cached";

export interface AdapterResult<T> {
  data: T;
  /** Which sponsor/vendor this stage is attributed to. */
  vendor: Vendor;
  provenance: Provenance;
  /** Human-readable note shown in the audit trail, e.g. "no credentials configured". */
  note: string;
  /** Milliseconds the stage took, wall clock. */
  ms: number;
}

export type Vendor =
  | "nutrient"
  | "llm"
  | "serpapi"
  | "doctavian"
  | "foxit"
  | "xano";

export const VENDOR_LABEL: Record<Vendor, string> = {
  nutrient: "Nutrient DWS",
  llm: "LLM",
  serpapi: "SerpApi",
  doctavian: "Doctavian",
  foxit: "Foxit eSign",
  xano: "Xano",
};

/** What each vendor is responsible for — shown on the judges page. */
export const VENDOR_ROLE: Record<Vendor, string> = {
  nutrient:
    "Parses the bill into structured line items with per-field confidence, and drives the human-review gate.",
  llm: "Reads the whole encounter and finds what the rules engine cannot, then argues each finding persuasively.",
  serpapi: "Pulls live market and reference pricing to prove each charge is inflated.",
  doctavian:
    "Generates the dispute letter from a branching template that loops over disputed lines and calculates totals.",
  foxit: "Carries the finished letter across the signing boundary to a human signature.",
  xano: "Backend of record: cases, line items, audit trail, and status.",
};

// ---------------------------------------------------------------------------
// Bill + extraction
// ---------------------------------------------------------------------------

export interface LineItem {
  id: string;
  /** CPT / HCPCS / revenue code as printed on the bill. */
  code: string;
  codeSystem: "CPT" | "HCPCS" | "REV" | "NDC" | "UNKNOWN";
  description: string;
  units: number;
  /** What the provider charged, in dollars. */
  charged: number;
  dateOfService: string;
  /** 0..1 — extraction confidence for this row. */
  confidence: number;
  /** True when confidence fell below the review threshold and a human must confirm. */
  needsReview: boolean;
  /** Set once a human has confirmed or corrected the row. */
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface BillMeta {
  provider: string;
  providerAddress: string;
  patientName: string;
  accountNumber: string;
  serviceDate: string;
  statementDate: string;
  insurer?: string;
  policyNumber?: string;
  /** Total as printed on the bill — used to sanity-check extraction. */
  statedTotal: number;
}

export interface ExtractionResult {
  meta: BillMeta;
  lines: LineItem[];
  /** Overall document-level extraction confidence, 0..1. */
  documentConfidence: number;
  pageCount: number;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export type FindingKind =
  | "duplicate"
  | "upcoding"
  | "unbundling"
  | "phantom"
  | "price_gouging"
  | "quantity_error"
  | "not_covered_bundled";

export const FINDING_LABEL: Record<FindingKind, string> = {
  duplicate: "Duplicate charge",
  upcoding: "Upcoding",
  unbundling: "Unbundling",
  phantom: "Phantom charge",
  price_gouging: "Excessive markup",
  quantity_error: "Quantity error",
  not_covered_bundled: "Should be bundled",
};

export type Severity = "high" | "medium" | "low";

export interface Finding {
  id: string;
  lineIds: string[];
  kind: FindingKind;
  severity: Severity;
  /** One-sentence, plain-English statement of what is wrong. */
  title: string;
  /** The argument a human would make to a billing department. */
  rationale: string;
  /** Dollars we contend should come off the bill for this finding. */
  disputedAmount: number;
  /** Regulation, coding rule, or standard this leans on. */
  citation: string;
  /** 0..1 — how confident the auditor is in this finding. */
  confidence: number;
}

export interface AuditResult {
  findings: Finding[];
  totalDisputed: number;
  summary: string;
}

// ---------------------------------------------------------------------------
// Benchmarking
// ---------------------------------------------------------------------------

export interface PriceEvidence {
  lineId: string;
  code: string;
  description: string;
  charged: number;
  /** Medicare / published reference rate for this code. */
  referenceRate: number;
  /** Median of observed market prices. */
  marketMedian: number;
  /** charged / marketMedian, e.g. 6.2 means 620% of the going rate. */
  markupMultiple: number;
  /** Where the market numbers came from. */
  sources: PriceSource[];
}

export interface PriceSource {
  label: string;
  price: number;
  url?: string;
}

export interface BenchmarkResult {
  evidence: PriceEvidence[];
  /** Total overcharge attributable to pricing alone. */
  totalOvercharge: number;
}

// ---------------------------------------------------------------------------
// Document + signature
// ---------------------------------------------------------------------------

export interface GeneratedDocument {
  documentId: string;
  title: string;
  /** Rendered letter body, used for the on-screen preview. */
  bodyText: string;
  /** Base64 PDF. */
  pdfBase64: string;
  pageCount: number;
  /** Which template branches fired — Doctavian's differentiator, shown in the UI. */
  branchesTaken: string[];
}

export type SignatureStatus = "unsent" | "awaiting_signature" | "signed" | "declined";

export interface SignatureRequest {
  envelopeId: string;
  status: SignatureStatus;
  signerName: string;
  signerEmail: string;
  /** URL a human visits to sign. In fallback mode this is a local route. */
  signingUrl: string;
  createdAt: string;
  signedAt?: string;
  /** SHA-256 of the exact bytes that were sent for signature. */
  documentHash: string;
}

// ---------------------------------------------------------------------------
// Case + audit trail
// ---------------------------------------------------------------------------

export type CaseStatus =
  | "extracting"
  | "awaiting_review"
  | "auditing"
  | "benchmarking"
  | "drafting"
  | "awaiting_signature"
  | "signed"
  | "submitted";

export interface AuditTrailEntry {
  id: string;
  at: string;
  stage: string;
  vendor: Vendor | "system";
  provenance: Provenance | "system";
  detail: string;
  /** Present on human decisions — this is what makes the trail defensible. */
  actor?: string;
}

export interface CaseRecord {
  id: string;
  createdAt: string;
  status: CaseStatus;
  meta: BillMeta;
  lines: LineItem[];
  findings: Finding[];
  evidence: PriceEvidence[];
  document?: GeneratedDocument;
  signature?: SignatureRequest;
  trail: AuditTrailEntry[];
  /** Denormalized for the dashboard. */
  billedTotal: number;
  disputedTotal: number;
}
