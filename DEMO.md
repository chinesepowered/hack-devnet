# Demo run sheet

A three-minute walkthrough that works with zero credentials, and gets better with each one you add.

---

## Twenty minutes before

```bash
pnpm install
pnpm doctor     # what will run live vs fallback
pnpm smoke      # proves the whole pipeline, ~2 seconds, no browser
pnpm build && pnpm start
```

Then open `http://localhost:3000`, press **D** once to warm the run, and press **R** to reset. If
that worked, nothing on stage can surprise you.

Two settings worth checking: browser zoom at 100%, and your OS notifications off.

---

## The three-minute version

### 0:00 — The hook *(intake screen)*

> "Four in five hospital bills contain an error. Almost nobody catches them, because catching one
> means knowing that a comprehensive metabolic panel already includes the creatinine test billed
> three lines below it."

Click **Emergency room visit**. A real bill: $18,400 for a fall on a hiking trail.

### 0:20 — Extraction and the first human gate

Line items stream in with a confidence score each. Point at the ones in amber.

> "The parser matched 'MISC SUPPLY CHG' to code 99070 on wording alone, and it's only 82% sure. So
> it stops. Nothing uncertain reaches the letter unconfirmed."

Confirm the fields. Point at the audit trail on the right — the human decision is recorded with a
name and a timestamp.

> "That's the difference between 'a model said so' and a record a regulator can follow."

### 0:50 — The audit

Findings appear largest-first. Take the top three:

- **$3,200 duplicate** — the same emergency visit code billed twice on one date.
- **$1,300 bundled supplies** — a surgical tray and a "misc supply charge" that the facility fee
  already pays for.
- **$1,240 phantom visit** — three separate visit charges for a single encounter.

> "None of this needs an AI. These are published coding rules, and they run with no model in the
> loop. An open-weight Qwen3 model sits on top and finds what the rules can't — like a chest X-ray
> on a wrist injury — and rewrites the argument so a billing manager will act on it. Every number it
> returns is checked against the real line items, so it can't invent one."

### 1:30 — The evidence

The comparison bars. Find the saline bag.

> "A litre of saline: billed at $137, published rate $1.50. Ninety-one times. And we're not asking
> for $1.50 — we're asking for a defensible number, because a letter that demands a 99% write-off
> gets binned."

### 1:55 — The letter

Watch the branch list appear, then the letter type itself onto paper.

> "This isn't mail-merge. It branched on insured versus self-pay, added a verification paragraph
> because a human reviewed something, added a regulatory escalation clause because the disputed
> share crossed 40%, and calculated its own corrected balance."

### 2:20 — The boundary *(the moment that lands)*

Stop before signing.

> "Everything so far was reversible, so the agent did it unattended. A signature isn't. It's the
> agent making a legal assertion in your name, and there's no undo."

Click **Let the agent try to sign it**. It gets refused.

> "That's not a prompt telling it to behave. Signing needs a human confirmation, a single-use token
> minted when the document was prepared, and a hash that still matches. The agent has none of them.
> So an agent that gets confused, or prompt-injected by a malicious bill, can waste tokens and write
> a bad letter — it cannot produce a *signed* one."

Type the name. Sign.

### 2:45 — The close

> "$18,400 billed. $7,144 owed. And the last page of that PDF is every step we just took, in order,
> including which system did it and where the human stood behind it."

Open the signed PDF. Scroll to the audit trail page.

---

## The resilience beat *(30 seconds, if asked — and it's worth volunteering)*

Open **/judges**. Click a vendor chip to kill it. Run the demo again.

> "Every one of these has a working fallback. Same parser, same template logic, same signed PDF —
> the badge just flips to 'fallback' and the trail records why. I can run this whole thing with the
> wifi off."

---

## Questions you will get

**"Is this legal advice?"**
No. It prepares a dispute and cites the coding rule behind each finding. A person signs it and sends
it.

**"What if the AI hallucinates a charge?"**
It can't reach the letter. Every model finding is validated against real line ids and clamped to
what those lines were charged; the audit stage reports how many it rejected. And the structural
findings come from a rules engine with no model in it — point the endpoint at nothing and the
numbers don't move.

**"Which model, and why not a frontier one?"**
Any OpenAI-compatible endpoint; we run an open-weight Qwen3. The rules engine does the work that has
to be exact, so the model only needs contextual judgement and good English — which an 8B open model
handles, self-hosted, with no patient billing data leaving your own infrastructure.

**"Where do the reference prices come from?"**
Medicare fee-schedule national averages as the anchor, live market data on top. Production would
pull the actual CMS schedules; this is a hackathon build and the table is bundled.

**"Aren't you just disputing everything?"**
No — and that's a design decision. The markup threshold scales with the service: a saline bag at 90×
is indefensible, a surgical procedure at 10× is ordinary chargemaster behaviour. On the ER sample
the facility fee survives untouched. No pricing finding asks for more than 60% of a line.

**"Why three document APIs?"**
Different jobs. Nutrient does deterministic intake with confidence scores and a human-review gate.
Doctavian does complex generation — branching, looping, calculating. Foxit carries it across the
signing boundary. Each is doing what it's built for.

---

## If something goes wrong

| | |
|---|---|
| A vendor hangs | It can't — every call has a 12s timeout and falls back. Say so out loud; it's the point. |
| The page looks stale | `R` resets. If assets 404, a zombie server is serving an old build: `pkill -f next-server` and `pnpm start`. |
| You want a clean slate | `R`, or restart the server — the local case store is in-process. |
| Live demo feels risky | `DISABLE_VENDORS=nutrient,llm,serpapi,doctavian,foxit,xano` runs it fully offline, deterministically. |
