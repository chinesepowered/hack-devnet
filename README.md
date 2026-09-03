# BillShield

**Reads a hospital bill, finds the billing errors, proves the prices are inflated, and hands you a signed dispute letter with a record of every step.** Six sponsor APIs each own one stage of that pipeline. On the built-in emergency-room sample: **$18,400 billed → $7,144 owed.**

---

## The problem

Four in five itemized hospital bills contain an error, and almost nobody catches one. Catching one
means knowing that CPT 80053 already contains the creatinine assay billed three lines below it, that
a hospital cannot charge you separately for the surgical tray, and that a single encounter supports
a single evaluation-and-management code. The people who know that work for the hospital.

So the errors stand. A duplicated visit code, a lab panel billed alongside its own components, eight
litres of saline for an outpatient wrist injury — each one survives because reading the bill
properly is specialist work that nobody does for free.

## The solution

Point BillShield at a bill. It opens a case, extracts every line item with a confidence score, and
**stops** — anything the parser wasn't sure of goes to a human before it can be used. Then it finds
the duplicated, unbundled, and unsupported charges from published coding rules, prices each one
against Medicare rates and live market data, writes a dispute letter that argues every finding with
its authority, and takes that letter to a **human signature**.

What comes out is a signed, tamper-evident PDF whose last page is every step taken to produce it —
which system did what, and where a person stood behind it.

Design decisions carry the build:

- **The audit is a rules engine, not a prompt.** Structural findings come from published coding
  rules with no model in the loop. The model runs on top and never instead; every finding it returns
  is validated against real line IDs and clamped to what those lines were charged. Point it at a dead
  endpoint and the numbers don't move.
- **The signing boundary sits at reversibility.** The agent owns everything undoable and stops at
  the one thing that isn't. It has no code path that can produce a signature.

---

## Sponsor summary

| Sponsor | Stage it owns | What breaks without it | Where |
|---|---|---|---|
| **Nutrient DWS** | Document intake | Typed extraction with per-field confidence, and the human-review gate it triggers | `src/lib/adapters/nutrient.ts` |
| **Qwen3** (any OpenAI-compatible endpoint) | Judgement over the rules engine | Findings a table lookup can't make, and the persuasive rewrite of every rationale | `src/lib/adapters/llm.ts` |
| **SerpApi** | Price evidence | Live market prices with sources, embedded in the letter | `src/lib/adapters/serpapi.ts` |
| **Doctavian** | Document generation | A letter that branches, loops, and calculates per bill | `src/lib/letter-template.ts`, `adapters/doctavian.ts` |
| **Foxit eSign** | The signing boundary | The envelope, the hash, and the handoff to a person | `src/lib/adapters/foxit.ts` |
| **Xano** | Backend of record | Cases, findings, and the audit trail printed into the signed PDF | `src/lib/adapters/xano.ts` |

Every adapter returns an `AdapterResult` carrying not just data but **where the data came from**. The UI renders that provenance and the audit trail records it, so nothing on screen is a claim you can't verify.

---

## How we leveraged each sponsor

### Nutrient DWS — document intake and the human-review gate

We POST the bill to the **Data Extraction API** against a typed bill schema we define (provider,
account, dates, and a `line_items` array of procedure code, description, units, charge). Asking for
a checkable shape rather than raw text is the point of using a deterministic document platform: any
field that comes back missing or malformed becomes a review item instead of a silent guess. The
**Processor API** (`/build` with an OCR action) is the second path when only a text layer is
available, and the same statement parser runs over both.

Each row is then scored — a code we recognise, a printed description that agrees with that code's
official wording, a plausible quantity — and anything below **0.90 stops the pipeline**. A real
statement reads `MISC SUPPLY CHG`, not "Supplies and materials, unspecified", so that mismatch is
exactly what drives a row to a human. The reviewer confirms, corrects, or removes it, and their name
and the timestamp land in the audit trail.

> **Verify it:** run `pnpm sample-pdf` and drag `sample-bills/er-wrist.pdf` into the drop zone —
> that takes the live Data Extraction path rather than the built-in sample. Watch the Extraction
> stage, then the Review gate that holds everything until a person answers. 5 of 19 rows stop there.

### The model — the judgement layer

`src/lib/audit-rules.ts` runs first and always: duplicates, multiple E/M codes for one encounter,
panels billed with their own components, bundled supplies, imaging of a body region nothing else on
the bill treats, impossible quantities, and markup above a threshold that scales by service type.

An open-weight **Qwen3** model then reads the whole encounter and does two things the rules engine
can't: it finds what only makes sense in context — a chest X-ray on a wrist injury — and rewrites
the machine-authored rationales into the paragraph a billing manager will actually act on.

We talk to it over the **OpenAI-compatible chat completions API**, so it runs anywhere: W&B
Inference, vLLM, Ollama, LM Studio, OpenRouter, Together, or OpenAI itself. This build was developed
against `Qwen/Qwen3.8-27B` on W&B Inference. Set `LLM_BASE_URL`, `LLM_MODEL`, and
optionally `LLM_API_KEY`. Compatible servers disagree about structured output, so the adapter tries
strict `json_schema`, steps down to `json_object` when the server rejects it, and falls back to
parsing JSON out of a plain completion — stripping the `<think>` block Qwen3 emits and any markdown
fence along the way. The stage note says which mode the server accepted.

**The division of labour is enforced in code, not just asked for in the prompt.** Pricing and E/M
level belong to the rules engine — they're arithmetic against a published table with a deliberate
tier policy, *including the deliberate decision not to flag a markup that's defensible for its class
of service*. So `price_gouging` and `upcoding` findings from the model are rejected outright, as is
any finding that merely restates a structural one the engine already made. Without that boundary the
model re-opened the facility fee and turned a careful 62% dispute into an indiscriminate 95% one —
which hands the provider the easiest possible rebuttal.

**Every surviving model finding is then validated**: it must reference line IDs that exist, and its
disputed amount is clamped to the dollars still *unclaimed* on those lines, so a line the engine
already priced can't be disputed twice. On the ER sample the model contributes exactly one finding —
a type-and-screen billed on a non-surgical wrist injury — which is precisely the clinical judgement
a table lookup cannot make. The stage note reports what was kept, added, rewritten and rejected.

> **Verify it:** the audit stage note names the model, the structured-output mode, and the counts
> kept / added / rewritten / rejected. Then point `LLM_BASE_URL` at nothing and re-run — the
> structural numbers are identical.

### SerpApi — turning an opinion into evidence

"This seems expensive" is an opinion. "Here are four providers publishing this exact code at a tenth
of your price, retrieved today" is evidence, and it goes into the letter with its sources. We query
per disputed procedure code, pull dollar figures out of organic and shopping results, take the
median, and skip codes with no published reference rate — a bundled supply has nothing meaningful to
compare against, and an empty bar chart reads as a bug.

> **Verify it:** open any row in Price evidence for the observed prices and their links. The saline
> comparison — $137 a litre against a $1.50 published rate — is the one that lands.

### Doctavian — generation with real template logic

The letter is not mail-merge. One structured payload drives a template that **branches** (insured
vs. self-pay header; a verification paragraph only when a human reviewed something; a regulatory
escalation clause only above 40% disputed; an itemized records request only for findings below 0.60
confidence), **loops** (over every finding, and every line item inside each finding), and
**calculates** (per-section subtotals and the corrected balance).

Live, that payload is uploaded and rendered against a template in the Doctavian workspace, then the
PDF is downloaded. The local renderer implements the same template semantics, and **both report
which branches fired** — so the UI can show the template logic doing real work on this particular
bill rather than asserting that it did.

> **Verify it:** the Draft panel lists every branch evaluated. The ER sample fires 10; the childbirth
> sample fires a different set, because it crosses no escalation threshold.

### Foxit eSign — the signing boundary, and an argument about where it goes

Foxit leaves signing out of the agent's tool catalogue on purpose and invites a defence. Ours: **the
boundary does not belong at "signing" as an operation — it belongs at reversibility.**

Everything else here is undoable. Generate the wrong letter, convert it, merge it, hash it; redo any
of it and nothing in the world has changed. A signature is different in kind: it is the agent making
a legal assertion in a person's name, and there is no undo.

So `requestSignature()` is the agent's last unilateral act — it creates the envelope through the
eSign API and stops at `awaiting_signature`. `applySignature()` demands three things the agent
cannot produce: a **human confirmation**, a **single-use intent token** minted at preparation, and a
**document hash that still matches** what was presented. An agent that gets confused, is
prompt-injected by a malicious bill, or simply loops can waste tokens and write a bad letter. It
cannot produce a *signed* one.

We also hash **before** presenting rather than after signing, so the signer sees the hash of what
they're about to sign and an agent that alters the document in between invalidates its own envelope.

> **Verify it:** press *Let the agent try to sign it* on any prepared document — the API returns
> **403**. `pnpm smoke` asserts both that refusal and the rejection of a replayed envelope.

### Xano — the backend of record

Cases, line items, findings, evidence, and the audit trail persist through Xano, and that trail is
printed as the final page of the signed PDF — so what the screen shows and what the provider
receives are the same record. Generated PDFs stay in-process rather than being pushed to a records
API: they're megabytes of base64 that don't round-trip reliably, so only their metadata is
persisted, and reads merge the local bytes back in.

> **Verify it:** the Audit trail rail, and the same list on the last page of the downloaded PDF.

---

## Verification

```bash
pnpm preflight # which vendors will run live; probes each credential
pnpm smoke     # all three bills through every stage, plus both boundary assertions
pnpm shots     # walks the demo and writes screenshots to tmp-artifacts/
```

`pnpm smoke` also asserts what a demo can't show quickly: that no line is disputed twice, that no
finding references a line that doesn't exist, and that the disputed total never exceeds the amount
billed.

## Notes and honesty

- **Reference rates** approximate Medicare fee-schedule national averages — a defensible anchor, not
  a live CMS feed. Production would pull the actual schedules.
- **Markup findings scale by service type.** A saline bag at 90× the published rate is indefensible;
  a surgical procedure at 10× is ordinary chargemaster behaviour, because the charge bundles facility
  costs the professional fee schedule doesn't cover. Flagging both the same way would make the audit
  look like it just disputes everything. No single pricing finding asks for more than 60% of a line,
  and on the ER sample the facility fee survives untouched.
- **Findings that need the medical record say so** — confidence below 0.60, and the letter requests
  the specific document rather than asserting the charge is wrong.
- BillShield prepares a dispute; it does not give legal or medical advice.

## Keyboard

| Key | |
|---|---|
| `D` | run the full demo hands-free |
| `L` | toggle light mode |
| `R` | reset |

Pitch deck: [`slides.html`](slides.html) · Demo run sheet: [`DEMO.md`](DEMO.md)
