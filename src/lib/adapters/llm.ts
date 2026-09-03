import OpenAI from "openai";
import { z } from "zod";

import { LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, LLM_TIMEOUT_MS, vendorLive } from "../config";
import { stopwatch } from "../http";
import { runAuditRules } from "../audit-rules";
import { lookupReference } from "../fixtures/reference-prices";
import type { AdapterResult, AuditResult, BillMeta, Finding, LineItem } from "../types";

/**
 * The model — the judgement layer on top of the rules engine.
 *
 * Any OpenAI-compatible endpoint: vLLM, Ollama, Together, OpenRouter, LM
 * Studio, or OpenAI itself. Point LLM_BASE_URL at it, set LLM_MODEL, and go.
 *
 * The rules engine finds what is mechanically checkable. The model's job is
 * the part a table lookup cannot do: read the encounter as a whole, decide
 * whether a charge makes clinical sense, and write the paragraph a billing
 * manager will actually act on.
 *
 * It never runs unsupervised. Every finding it returns must reference real
 * line ids and a positive dollar amount, and its disputed totals are clamped
 * to what those lines were actually charged — a hallucinated number cannot
 * reach the letter.
 */

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
  improved_rationales: z.array(
    z.object({
      finding_id: z.string(),
      rationale: z.string(),
    }),
  ),
});

type AuditPayload = z.infer<typeof AuditSchema>;

const SYSTEM = `You are a medical billing advocate reviewing an itemized hospital bill on behalf of a patient.

You are given the extracted line items and the findings a deterministic rules engine has already produced. Your job has two parts:

1. Find what the rules engine missed. Look for services that make no clinical sense for this encounter, charges that contradict each other, missing or impossible date sequences, and items that would not survive a payer audit. Do not restate findings the engine already made.

2. Rewrite the engine's rationales so they read like a competent human advocate wrote them: specific, calm, factual, and citing the actual charge amounts and codes. No threats, no outrage, no invented facts.

What the rules engine already owns, and you must NOT re-argue:
- Pricing. It has already compared every charge against published reference rates using a tiered policy, and it deliberately leaves some markups alone because they are defensible for that class of service. A charge it did not flag on price was a judgement, not an oversight. Never return a price_gouging or upcoding finding.
- Anything it already listed. Do not restate an existing finding with different wording or against a different line of the same encounter.

Your job is the part it cannot do: clinical and contextual judgement. A service that makes no sense for this encounter, a sequence that cannot have happened, an item that contradicts another. If there is nothing of that kind, say so with an empty array.

Hard rules:
- Every line_id you reference must appear in the provided line items. Never invent one.
- Never invent a dollar amount. A finding's disputed_amount must not exceed the total charged on the lines it references.
- Never invent a regulation. If you are not sure of the exact citation, describe the rule in words instead.
- If you cannot find anything the engine missed, return an empty additional_findings array. An empty array is a good answer; a fabricated finding is not.
- Be honest about uncertainty. A finding that needs the medical record to confirm should have a confidence below 0.6 and should say what document is needed.

Reply with a single JSON object and nothing else. No prose before or after, no markdown fences.`;

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

Review this encounter. Return additional findings the engine missed, and improved rationales for the findings above.

Return JSON shaped exactly like:
{"summary": string,
 "additional_findings": [{"line_ids": [string], "kind": "duplicate"|"upcoding"|"unbundling"|"phantom"|"price_gouging"|"quantity_error"|"not_covered_bundled", "severity": "high"|"medium"|"low", "title": string, "rationale": string, "disputed_amount": number, "citation": string, "confidence": number}],
 "improved_rationales": [{"finding_id": string, "rationale": string}]}`;
}

// ---------------------------------------------------------------------------
// Structured output, across servers that disagree about how to do it
// ---------------------------------------------------------------------------

/**
 * OpenAI strict json_schema wants every object closed and every property
 * required. zod's emitted schema marks optionals and omits the flag, so walk
 * the tree and tighten it.
 */
function tightenSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(tightenSchema);
  if (!node || typeof node !== "object") return node;

  const obj = { ...(node as Record<string, unknown>) };
  for (const [k, v] of Object.entries(obj)) obj[k] = tightenSchema(v);

  if (obj.type === "object" && obj.properties && typeof obj.properties === "object") {
    obj.additionalProperties = false;
    obj.required = Object.keys(obj.properties as Record<string, unknown>);
  }
  // Draft-2020 keywords some servers reject on a strict schema.
  delete obj.$schema;
  delete obj.default;
  return obj;
}

/**
 * Qwen3 and other reasoning models emit a <think> block before the answer,
 * and plenty of servers wrap JSON in markdown fences. Strip both, then take
 * the outermost balanced object.
 */
export function extractJson(raw: string): string {
  let text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    // An unterminated think block means the model ran out of tokens mid-thought.
    .replace(/<think>[\s\S]*$/i, "")
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  const start = text.indexOf("{");
  if (start === -1) return text;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (c === '"') inString = !inString;
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

type ResponseFormatMode = "json_schema" | "json_object" | "none";

function looksUnsupported(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const message = String((err as { message?: string })?.message ?? err).toLowerCase();
  // 400/404/422 plus any mention of the parameter we just tried.
  return (
    (status === 400 || status === 404 || status === 422 || status === 500) &&
    /response_format|json_schema|schema|not supported|unsupported|unrecognized|invalid.*parameter/.test(
      message,
    )
  );
}

/**
 * Ask the model for the audit, degrading through the ways a server might
 * support structured output. Compatible endpoints disagree a lot here: strict
 * json_schema is best, json_object is common, and some support neither — so
 * we try each and fall back to parsing JSON out of plain text.
 */
async function requestAudit(
  client: OpenAI,
  model: string,
  prompt: string,
): Promise<{ payload: AuditPayload; mode: ResponseFormatMode }> {
  const jsonSchema = tightenSchema(z.toJSONSchema(AuditSchema, { io: "output" }));

  // Probing costs a failed round trip per unsupported mode. Once you know what
  // your server does, pin it with LLM_RESPONSE_FORMAT and skip straight to it.
  const pinned = (process.env.LLM_RESPONSE_FORMAT ?? "").trim() as ResponseFormatMode | "";
  const modes: ResponseFormatMode[] =
    pinned === "json_schema" || pinned === "json_object" || pinned === "none"
      ? [pinned]
      : ["json_schema", "json_object", "none"];
  let lastError: unknown;

  for (const mode of modes) {
    const responseFormat =
      mode === "json_schema"
        ? ({
            type: "json_schema",
            json_schema: { name: "bill_audit", schema: jsonSchema, strict: true },
          } as const)
        : mode === "json_object"
          ? ({ type: "json_object" } as const)
          : undefined;

    try {
      const completion = await client.chat.completions.create({
        model,
        temperature: 0.2,
        max_tokens: Number(process.env.LLM_MAX_TOKENS ?? 8000),
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt },
        ],
        ...(responseFormat ? { response_format: responseFormat } : {}),
        // Qwen3 reasoning is on by default on most servers and eats the token
        // budget before the JSON lands. Harmless where the server ignores it.
        ...(process.env.LLM_DISABLE_THINKING === "1"
          ? { chat_template_kwargs: { enable_thinking: false } }
          : {}),
      } as Parameters<typeof client.chat.completions.create>[0]);

      const done = completion as OpenAI.Chat.Completions.ChatCompletion;
      const choice = done.choices?.[0];
      const text = choice?.message?.content ?? "";

      if (!text.trim()) {
        // A reasoning model can spend its whole budget thinking and return no
        // content at all. Say so, because the fix is a setting, not a retry.
        const reasoning = (choice?.message as { reasoning?: string } | undefined)?.reasoning ?? "";
        if (choice?.finish_reason === "length" && reasoning.length > 0) {
          throw new Error(
            `model used all ${done.usage?.completion_tokens ?? "?"} completion tokens on reasoning and produced no answer — ` +
              `set LLM_DISABLE_THINKING=1, or raise LLM_MAX_TOKENS`,
          );
        }
        throw new Error(
          `model returned an empty message (finish_reason=${choice?.finish_reason ?? "unknown"})`,
        );
      }

      const parsed = AuditSchema.safeParse(JSON.parse(extractJson(text)));
      if (!parsed.success) {
        throw new Error(`response did not match the audit schema: ${parsed.error.issues[0]?.message}`);
      }
      return { payload: parsed.data, mode };
    } catch (err) {
      lastError = err;
      // Only step down when the server rejected the *parameter*; a genuine
      // model or network failure should surface rather than retry three times.
      if (mode !== "none" && looksUnsupported(err)) continue;
      throw err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Validate and clamp a model-proposed finding against the real line items.
 * Anything referencing an unknown line, or claiming more money than those
 * lines were charged, is rejected outright rather than trimmed silently.
 */
/**
 * How many dollars on each line nobody has claimed yet.
 *
 * The rules engine is careful never to dispute the same line twice, but model
 * findings are produced independently and would otherwise be free to re-claim
 * a line the engine already took a share of. Allocating what is already spent
 * — pro rata across the lines each finding covers — is what stops the totals
 * drifting toward "we dispute the entire bill".
 */
function remainingByLine(lines: LineItem[], claimed: Finding[]): Map<string, number> {
  const remaining = new Map(lines.map((l) => [l.id, l.charged]));
  const byId = new Map(lines.map((l) => [l.id, l]));

  for (const f of claimed) {
    const covered = f.lineIds.reduce((s, id) => s + (byId.get(id)?.charged ?? 0), 0);
    for (const id of f.lineIds) {
      const line = byId.get(id);
      if (!line) continue;
      const share =
        covered > 0 ? (line.charged / covered) * f.disputedAmount : f.disputedAmount / f.lineIds.length;
      remaining.set(id, Math.max(0, (remaining.get(id) ?? 0) - share));
    }
  }
  return remaining;
}

/**
 * Kinds the rules engine owns outright.
 *
 * Pricing and E/M level are arithmetic against a published table with a
 * deliberate tier policy — including the deliberate decision NOT to flag a
 * markup that is defensible for its class of service. Letting the model
 * re-open those turns a careful 62% dispute into an indiscriminate 95% one,
 * and hands the provider the easiest possible rebuttal.
 */
const ENGINE_OWNED: ReadonlySet<string> = new Set(["price_gouging", "upcoding"]);

function acceptFinding(
  raw: z.infer<typeof FindingSchema>,
  lines: LineItem[],
  index: number,
  remaining: Map<string, number>,
  claimedLines: ReadonlySet<string>,
): Finding | null {
  if (ENGINE_OWNED.has(raw.kind)) return null;

  const byId = new Map(lines.map((l) => [l.id, l]));
  const referenced = raw.line_ids.filter((id) => byId.has(id));
  if (referenced.length === 0) return null;

  // Every line is already the subject of a *structural* engine finding, so this
  // restates it — possibly reworded and pointed at a neighbouring line's
  // headroom. A line the engine merely priced is fair game: "this service was
  // not warranted at all" is a different argument from "it costs too much",
  // and the remaining-dollars clamp keeps the two from overlapping.
  if (referenced.every((id) => claimedLines.has(id))) return null;

  // Ceiling is what is left on those lines, not what they were charged.
  const ceiling = referenced.reduce((s, id) => s + (remaining.get(id) ?? 0), 0);
  const amount = Math.min(Math.max(0, raw.disputed_amount), ceiling);
  if (amount < 1) return null;

  // Spend it, so a second model finding cannot claim the same dollars.
  const covered = referenced.reduce((s, id) => s + (byId.get(id)?.charged ?? 0), 0);
  for (const id of referenced) {
    const line = byId.get(id)!;
    const share = covered > 0 ? (line.charged / covered) * amount : amount / referenced.length;
    remaining.set(id, Math.max(0, (remaining.get(id) ?? 0) - share));
  }

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

  // The rules engine always runs. The model augments it; it never replaces it.
  const base = runAuditRules(lines);

  if (!vendorLive("llm")) {
    return {
      data: base,
      vendor: "llm",
      provenance: "fallback",
      note: `no model endpoint configured — ${base.findings.length} findings from the deterministic rules engine`,
      ms: elapsed(),
    };
  }

  const model = LLM_MODEL();

  try {
    const client = new OpenAI({
      baseURL: LLM_BASE_URL(),
      // Local servers often want no key at all, but the SDK requires a string.
      apiKey: LLM_API_KEY() || "not-required",
      timeout: LLM_TIMEOUT_MS,
      // A retry doubles the wall clock on a slow endpoint and the pipeline has
      // a fallback anyway — better to fail once and move on.
      maxRetries: 0,
    });

    const { payload, mode } = await requestAudit(
      client,
      model,
      buildPrompt(meta, lines, base.findings),
    );

    // Seeded with what the rules engine already claimed, then drawn down as
    // each model finding is accepted.
    const remaining = remainingByLine(lines, base.findings);
    const claimedLines = new Set(
      base.findings.filter((f) => f.kind !== "price_gouging").flatMap((f) => f.lineIds),
    );
    const extra = payload.additional_findings
      .map((f, i) => acceptFinding(f, lines, i, remaining, claimedLines))
      .filter((f): f is Finding => f !== null);

    const rewrites = new Map(
      payload.improved_rationales.map((r) => [r.finding_id, r.rationale.trim()]),
    );
    const improved = base.findings.map((f) =>
      rewrites.has(f.id) && rewrites.get(f.id)!.length > 40
        ? { ...f, rationale: rewrites.get(f.id)! }
        : f,
    );

    const findings = [...improved, ...extra].sort(
      (a, b) => b.disputedAmount - a.disputedAmount,
    );
    const rejected = payload.additional_findings.length - extra.length;
    const applied = improved.filter((f, i) => f.rationale !== base.findings[i].rationale).length;

    return {
      data: {
        findings,
        totalDisputed: Number(
          findings.reduce((s, f) => s + f.disputedAmount, 0).toFixed(2),
        ),
        summary: payload.summary.trim() || base.summary,
      },
      vendor: "llm",
      provenance: "live",
      note:
        `${model} reviewed ${lines.length} lines via ${mode === "none" ? "plain completion" : mode}: ` +
        `${base.findings.length} rules-engine findings kept, ${extra.length} added, ` +
        `${applied} rationales rewritten` +
        (rejected > 0 ? `, ${rejected} rejected as unverifiable or already covered` : ""),
      ms: elapsed(),
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      data: base,
      vendor: "llm",
      provenance: "fallback",
      note: `${model} unavailable (${reason}) — ${base.findings.length} findings from the deterministic rules engine`,
      ms: elapsed(),
    };
  }
}
