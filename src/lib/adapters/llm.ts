import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { ANTHROPIC_KEY, vendorLive, VENDOR_TIMEOUT_MS } from "../config";
import { stopwatch } from "../http";
import { runAuditRules } from "../audit-rules";
import { lookupReference } from "../fixtures/reference-prices";
import type { AdapterResult, AuditResult, BillMeta, Finding, LineItem } from "../types";

/**
 * Claude — the judgement layer on top of the rules engine.
 *
 * The rules engine finds what is mechanically checkable. Claude's job is the
 * part a table lookup cannot do: read the encounter as a whole, decide whether
 * a charge makes clinical sense, and write the paragraph a billing manager
 * will actually act on.
 *
 * It never runs unsupervised. Every finding Claude returns must reference real
 * line ids and a positive dollar amount, and its disputed totals are clamped to
 * what those lines were actually charged — a hallucinated number cannot reach
 * the letter.
 */

const MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5";

const FindingSchema = z.object({
  line_ids: z.array(z.string()).describe("ids of the line items this finding concerns"),
  kind: z.enum([
    "duplicate",
    "upcoding",
    "unbundling",
    "phantom",
    "price_gouging",
    "quantity_error",
    "not_covered_bundled",
  ]),
  severity: z.enum(["high", "medium", "low"]),
  title: z.string().describe("one sentence, plain English, no jargon"),
  rationale: z
    .string()
    .describe(
      "the argument a patient advocate would make to a billing department: what is wrong, why, and what should happen",
    ),
  disputed_amount: z.number().describe("dollars that should come off the bill for this finding"),
  citation: z.string().describe("the coding rule, regulation, or standard this relies on"),
  confidence: z.number().min(0).max(1),
});

const AuditSchema = z.object({
  summary: z.string().describe("two sentences a patient can understand"),
  additional_findings: z
    .array(FindingSchema)
    .describe("issues the rules engine did not already catch; empty array is fine"),
  /** Claude rewrites the machine-written rationales into something persuasive. */
  improved_rationales: z.array(
    z.object({
      finding_id: z.string(),
      rationale: z.string(),
    }),
  ),
});

const SYSTEM = `You are a medical billing advocate reviewing an itemized hospital bill on behalf of a patient.

You are given the extracted line items and the findings a deterministic rules engine has already produced. Your job has two parts:

1. Find what the rules engine missed. Look for services that make no clinical sense for this encounter, charges that contradict each other, missing or impossible date sequences, and items that would not survive a payer audit. Do not restate findings the engine already made.

2. Rewrite the engine's rationales so they read like a competent human advocate wrote them: specific, calm, factual, and citing the actual charge amounts and codes. No threats, no outrage, no invented facts.

Hard rules:
- Every line_id you reference must appear in the provided line items. Never invent one.
- Never invent a dollar amount. A finding's disputed_amount must not exceed the total charged on the lines it references.
- Never invent a regulation. If you are not sure of the exact citation, describe the rule in words instead.
- If you cannot find anything the engine missed, return an empty additional_findings array. An empty array is a good answer; a fabricated finding is not.
- Be honest about uncertainty. A finding that needs the medical record to confirm should have a confidence below 0.6 and should say what document is needed.`;

function buildPrompt(meta: BillMeta, lines: LineItem[], base: Finding[]): string {
  const lineTable = lines
    .map(
      (l) =>
        `${l.id} | ${l.code} | ${l.description} | qty ${l.units} | $${l.charged.toFixed(2)} | ${l.dateOfService} | extraction confidence ${l.confidence}` +
        (lookupReference(l.code)
          ? ` | published reference rate $${lookupReference(l.code)!.referenceRate.toFixed(2)}/unit`
          : " | code not in reference table"),
    )
    .join("\n");

  const existing = base
    .map(
      (f) =>
        `${f.id} | ${f.kind} | ${f.title} | $${f.disputedAmount.toFixed(2)} | lines: ${f.lineIds.join(", ")}`,
    )
    .join("\n");

  return `ENCOUNTER
Provider: ${meta.provider}
Patient: ${meta.patientName}
Date of service: ${meta.serviceDate}
Total billed: $${meta.statedTotal.toLocaleString()}
Coverage: ${meta.insurer ? `${meta.insurer}, policy ${meta.policyNumber}` : "self-pay"}

LINE ITEMS
${lineTable}

FINDINGS ALREADY MADE BY THE RULES ENGINE
${existing || "(none)"}

Review this encounter. Return additional findings the engine missed, and improved rationales for the findings above.`;
}

/**
 * Validate and clamp a model-proposed finding against the real line items.
 * Anything referencing an unknown line, or claiming more money than those
 * lines were charged, is rejected outright rather than trimmed silently.
 */
function acceptFinding(
  raw: z.infer<typeof FindingSchema>,
  lines: LineItem[],
  index: number,
): Finding | null {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const referenced = raw.line_ids.filter((id) => byId.has(id));
  if (referenced.length === 0) return null;

  const ceiling = referenced.reduce((s, id) => s + (byId.get(id)?.charged ?? 0), 0);
  const amount = Math.min(Math.max(0, raw.disputed_amount), ceiling);
  if (amount < 1) return null;

  return {
    id: `f-ai-${index + 1}`,
    lineIds: referenced,
    kind: raw.kind,
    severity: raw.severity,
    title: raw.title.trim(),
    rationale: raw.rationale.trim(),
    disputedAmount: Number(amount.toFixed(2)),
    citation: raw.citation.trim(),
    confidence: Math.max(0, Math.min(1, raw.confidence)),
  };
}

export async function auditBill(
  meta: BillMeta,
  lines: LineItem[],
): Promise<AdapterResult<AuditResult>> {
  const elapsed = stopwatch();

  // The rules engine always runs. Claude augments it; it never replaces it.
  const base = runAuditRules(lines);

  if (!vendorLive("anthropic")) {
    return {
      data: base,
      vendor: "anthropic",
      provenance: "fallback",
      note: `no Anthropic key configured — ${base.findings.length} findings from the deterministic rules engine`,
      ms: elapsed(),
    };
  }

  try {
    const client = new Anthropic({
      apiKey: ANTHROPIC_KEY(),
      timeout: VENDOR_TIMEOUT_MS * 4,
      maxRetries: 1,
    });

    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      // Thinking is on by default on Opus 5 — omitting the parameter runs
      // adaptive, which is what we want for this kind of judgement call.
      output_config: {
        effort: "medium",
        format: zodOutputFormat(AuditSchema),
      },
      messages: [{ role: "user", content: buildPrompt(meta, lines, base.findings) }],
    });

    if (response.stop_reason === "refusal") {
      // stop_details is newer than this SDK's types; read it defensively.
      const details = (response as { stop_details?: { category?: string } }).stop_details;
      throw new Error(`model declined: ${details?.category ?? "unspecified"}`);
    }

    const parsed = response.parsed_output;
    if (!parsed) throw new Error("model returned no parsable output");

    const extra = parsed.additional_findings
      .map((f, i) => acceptFinding(f, lines, i))
      .filter((f): f is Finding => f !== null);

    const rewrites = new Map(
      parsed.improved_rationales.map((r) => [r.finding_id, r.rationale.trim()]),
    );
    const improved = base.findings.map((f) =>
      rewrites.has(f.id) && rewrites.get(f.id)!.length > 40
        ? { ...f, rationale: rewrites.get(f.id)! }
        : f,
    );

    const findings = [...improved, ...extra].sort(
      (a, b) => b.disputedAmount - a.disputedAmount,
    );
    const rejected = parsed.additional_findings.length - extra.length;

    return {
      data: {
        findings,
        totalDisputed: Number(
          findings.reduce((s, f) => s + f.disputedAmount, 0).toFixed(2),
        ),
        summary: parsed.summary.trim() || base.summary,
      },
      vendor: "anthropic",
      provenance: "live",
      note:
        `${MODEL} reviewed ${lines.length} lines: ${base.findings.length} rules-engine findings kept, ` +
        `${extra.length} added, ${rewrites.size} rationales rewritten` +
        (rejected > 0 ? `, ${rejected} rejected as unverifiable` : ""),
      ms: elapsed(),
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      data: base,
      vendor: "anthropic",
      provenance: "fallback",
      note: `Claude unavailable (${reason}) — ${base.findings.length} findings from the deterministic rules engine`,
      ms: elapsed(),
    };
  }
}
