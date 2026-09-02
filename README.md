# BillShield

**Reads a hospital bill, finds the billing errors, proves the prices are inflated, and hands you a signed dispute letter with a record of every step.**

Four in five itemized hospital bills contain an error. Almost nobody reads them, because reading
one means knowing that CPT 80053 already contains the creatinine test billed three lines below it,
and that a hospital cannot charge you separately for the surgical tray. BillShield knows.

Point it at a bill and it opens a case, extracts every line item with a confidence score, stops and
asks a human about anything it wasn't sure of, finds the duplicated and unbundled and unsupported
charges, prices each one against published rates and live market data, writes a dispute letter that
argues each finding with its authority, and takes it to a human signature — leaving behind an audit
trail a regulator could follow.

On the built-in emergency-room sample, that is **$18,400 billed → $7,144 owed**.

---

## Run it

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

That's the whole setup. **No API keys are required** — every vendor has a working fallback, and the
interface always tells you which mode each stage ran in. Add credentials whenever you like:

```bash
cp .env.example .env.local    # fill in whatever you have
pnpm doctor                   # reports what will run live vs. fallback, and probes the keys
pnpm smoke                    # exercises the whole pipeline from the CLI, no browser needed
pnpm shots                    # walks the demo and writes screenshots to tmp-artifacts/
```

In the app, press **D** to run the entire demo hands-free.

---

## The pipeline

Six APIs, each owning one stage. Every stage is independently observable and independently
survivable.

| Stage | API | What it actually does |
|---|---|---|
| **Extract** | Nutrient DWS | Parses the PDF into typed line items with per-field confidence, using the Data Extraction API against a bill schema we define. |
| **Review** | *a human* | Rows scoring below 0.90 stop here. Nothing uncertain reaches the letter unconfirmed. |
| **Audit** | Claude | Reads the encounter as a whole and finds what a rules engine can't, then rewrites the machine-authored rationales into an argument that persuades. |
| **Benchmark** | SerpApi | Turns "this seems expensive" into evidence: what other providers publish for the same code, today, with sources. |
| **Draft** | Doctavian | Renders the letter from a template that branches, loops, and calculates. |
| **Sign** | Foxit eSign | Carries the letter across the signing boundary to a person. |
| *(throughout)* | Xano | Backend of record: cases, findings, and the audit trail that gets printed into the signed PDF. |

---

## Three things worth looking at

### 1. The audit is a real rules engine, not a prompt

`src/lib/audit-rules.ts` finds structural billing errors from published coding rules alone, with no
model in the loop: exact duplicates, multiple evaluation-and-management codes for one encounter,
panels billed alongside their own components, supplies that belong inside a facility fee, imaging of
a body region nothing else on the bill treats, quantities beyond what one encounter supports, and
charges above a markup threshold that scales with what the service is.

Claude runs *on top of* that, never instead of it. Every finding the model returns is validated
against real line ids and clamped to what those lines were actually charged, so a hallucinated
number cannot reach the letter. The audit stage reports how many model findings it rejected.

Two consequences: the demo produces identical, defensible numbers with no API key at all, and every
dollar in the letter traces to a rule you can read.

### 2. The signing boundary is enforced in code

Foxit's challenge leaves signing out of the agent's tool catalogue on purpose and invites an
argument about where the boundary belongs. Ours: **not at "signing" as an operation — at
reversibility.**

Everything else here is undoable. Generate the wrong letter, convert it, merge it, hash it; redo any
of it and nothing in the world has changed. A signature is different in kind: it is the agent making
a legal assertion in a person's name, and there is no undo.

So `requestSignature()` is the agent's last unilateral act — it prepares an envelope and stops.
`applySignature()` demands three things the agent cannot produce: a human confirmation, a single-use
intent token minted at preparation, and a document hash that still matches what was presented. An
agent that gets confused, is prompt-injected by a malicious bill, or simply loops can waste tokens
and produce a wrong letter. It cannot produce a *signed* one.

There's a button in the UI that has the agent try anyway. It gets a 403. `pnpm smoke` asserts it.

We also hash *before* presenting rather than after signing, so the signer sees the hash of what
they're about to sign and an agent that alters the document in between invalidates its own envelope.

### 3. Every vendor can be killed mid-demo

Open `/judges` and click any vendor chip to switch it off, then run the pipeline again. It completes
either way; the stage badge flips to `fallback` and the audit trail records exactly why. The
fallbacks aren't stubs — the local parser is the same parser the live path uses, the local letter
renderer implements the same template semantics, and the local signing ceremony still produces a
real, hashed, audit-stamped PDF.

This is the difference between a demo that survives conference wifi and one that doesn't.

---

## Layout

```
src/
  lib/
    audit-rules.ts          deterministic billing-error detection
    letter-template.ts      the branching/looping/calculating letter
    pdf.ts                  local PDF rendering + signature stamping
    fixtures/
      reference-prices.ts   published rates, bundling rules, pricing tiers
      bills.ts              three realistic bills with genuine errors planted
    adapters/
      nutrient.ts  llm.ts  serpapi.ts  doctavian.ts  foxit.ts  xano.ts
  app/
    api/cases/[id]/...      one route per pipeline stage
    judges/                 sponsor scorecard + the chaos switch
  components/               the studio UI
scripts/
  doctor.ts                 pre-demo credential check
  smoke.ts                  full pipeline test, including boundary assertions
```

Every adapter returns an `AdapterResult` carrying not just data but **where the data came from** —
`live` or `fallback`, with a human-readable note. The UI renders that provenance and the audit trail
records it, so nothing on screen is a claim you can't verify.

---

## Notes and honesty

- **Reference rates** approximate Medicare fee-schedule national averages. They're a defensible
  anchor, not a live CMS feed; a production build would pull the actual schedules.
- **Markup findings scale by service type.** A saline bag at 90× the published rate is
  indefensible; a surgical procedure at 10× is ordinary hospital chargemaster behaviour, because the
  charge bundles facility costs the professional fee schedule doesn't cover. Flagging both the same
  way would make the audit look like it just disputes everything. No single pricing finding asks for
  more than 60% of a line.
- **Findings that need the medical record say so.** They carry confidence below 0.6, and the letter
  requests the specific document rather than asserting the charge is wrong.
- BillShield prepares a dispute; it doesn't give legal or medical advice.

---

## Keyboard

| Key | |
|---|---|
| `D` | run the full demo hands-free |
| `L` | toggle light mode |
| `R` | reset |
