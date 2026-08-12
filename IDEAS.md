# DevNetwork [API + Cloud + AI] Hackathon 2026 — Prize Strategy

**Event:** Aug 17 – Sept 3, 2026. Online + in-person at Santa Clara Convention Center (Sept 2–3).
**Winners announced:** Sept 3, 3:30 PM PT, API World main stage.
**Researched:** Aug 12, 2026. Four sponsor tracks (Foxit, Apptio, useBruno, Wundergraph) were still "Coming Soon" at the time of writing — re-check before locking scope.

---

## The rule that decides everything

> "Teams can solve no challenges (build whatever you want) or can submit to **as many challenges as they want**." — apiworld.co/hackathon

Judging runs in two rounds. **Round 1** is general, scored on three things: how much progress you made, whether it solves a real problem, and whether it could become a company. **Round 2** is the sponsor round — each sponsor judges only the projects entered in their own challenge and picks their own winners.

The consequence: your build is not one bet, it's a *portfolio*. One well-chosen project can enter five or six challenges, and each one is a separate field with separate judges. Optimize for the number of tracks a single coherent product can enter **without any integration feeling bolted on** — every sponsor's criteria include integration depth, and a gratuitous API call reads as exactly what it is.

---

## The board

| Track | Pot | 1st / 2nd | Cash vs. credits | Field read |
|---|---:|---|---|---|
| **Overall Winner** | $12,500 | $12,500 | all cash | Everyone. ~1 in 150+ |
| SerpApi — Best AI Use Case | $3,000 | $1k cash + $1k credits / $500 + $500 | half credits | **Crowded** — trivially easy to add |
| Perfect Corp — AI consumer experiences | $2,500 | $1,500 / $1,000 | **all cash** | Crowded — flashy, partner sponsor |
| Xano — Rebuild a SaaS tool you hate | $2,500 | $1k cash + $500 credit / $500 + $500 | mostly cash | Medium — learning curve thins it |
| name.com — Domain API | $2,000 | $1,500 / $500 Amazon GC | gift card | Medium — hard to make *central* |
| Nutrient — DWS document ops | $1,500 | $750 Visa + credits / $250 + credits | mostly cash | **Thin** — unsexy |
| Doctavian — Documents + signing | $1,000 | $500 + sub / $200 + sub | part sub | **Thin** — unsexy |
| Foxit | $1,000 | TBA | TBA | **Thin** — details posted late |
| Apptio (IBM) | $1,000 | TBA | TBA | **Thin** — FinOps, niche |
| useBruno | $1,000 | TBA | TBA | **Thinnest** — devtool |
| Wundergraph | $1,000 | TBA | TBA | **Thinnest** — devtool |

Headline pool is $45,500; the tracks above account for roughly **$28,000 in cash and gift cards**. The remainder is credits, conference passes, and hardware (1st place also gets Amazon Echos, 2027 all-access passes, and a feature in a 60k-subscriber email).

**Two things fall out of this table.** First, credits are not cash — SerpApi's $3,000 is really $1,500 cash, and Nutrient's $1,500 is really $1,000. Second, the unglamorous tracks pay nearly as well as the glamorous ones and will have a fraction of the entries. A project that legitimately sweeps Nutrient + Doctavian + Foxit is worth more than a second-place finish in Perfect Corp, and is far more likely.

---

## API reality check

Verified against each sponsor's live docs (most publish `llms.txt`):

| API | What you actually get | Friction |
|---|---|---|
| **Nutrient DWS** | Data Extraction → structured JSON w/ confidence scores; Processor (convert, merge, OCR, watermark); Viewer; redaction; eSign; PDF/UA tagging | **Lowest.** 5,000 credits/mo free, no card, playground needs no signup |
| **SerpApi** | 100+ engines: Google (incl. AI Mode + AI Overview), Shopping, Maps, Scholar, Flights, Amazon, Walmart, eBay, reviews | **Lowest.** `GET /search?api_key=…`, JSON out |
| **name.com** | Search, CheckAvailability (50/call), ZoneCheck (batch, cached), full DNS CRUD, DNSSEC, vanity NS, transfers, WHOIS privacy | Low. HTTP Basic Auth, **sandbox env**, OpenAPI spec |
| **Perfect Corp** | AI Skin Analysis (14 concerns + skin age), **AI Aging Simulation**, skin simulation, 50+ try-ons (makeup, hair, clothes, jewelry) | Medium. Key at `yce.perfectcorp.com/api-console`, free trial credits, webhooks, MCP support |
| **Xano** | Postgres w/ vector fields, auth + RBAC, triggers, background tasks, realtime, file storage, **MCP Builder + AI Agents**, XanoScript, Git sync | Medium. Visual builder — budget a day to learn |
| **Foxit** | PDF Services (convert/merge/extract/optimize), Document Generation, eSign, Embed viewer | Low. Free dev account, no card |
| **Doctavian** | Generation from templates w/ conditional rules, signing, verification. Headless/API-first | Medium. Trial at `portal.doctavian.com/trial`, docs at `docs.mavenmule.com` |
| **useBruno** | `.bru` files, CLI w/ CI, OpenAPI import/export **and sync**, `bru.ctx` custom-apps framework, GraphQL/gRPC/WS/SSE | Low. Open source, local |
| **Wundergraph Cosmo** | Federated GraphQL, Go router, schema registry w/ breaking-change detection, tracing, feature flags, **MCP Gateway** | Medium-high. Apache 2.0 |

Note the two accidental gifts: Perfect Corp ships an **Aging Simulation** endpoint, and Nutrient's marketing explicitly sells *deterministic, auditable* output — which is also, word for word, what their challenge brief asks you to demonstrate.

---

## 14 ideas

"Reach" = total pot of tracks the build can legitimately enter. It's an upper bound and a measure of shots on goal, not expected winnings.

### Tier 1 — build one of these

#### 1. Denial — fight a medical bill or an insurance denial
**Reach: $9,000** · Nutrient · Doctavian · Foxit · SerpApi · Xano

Drop in a hospital bill or a denial letter. It finds the errors, prices every line against real market rates, and hands you a signed appeal letter ready to send.

*The demo:* drag in a scary $18,400 bill → PDF redlines itself live → "4 duplicate charges, 2 upcoded CPT codes, **$4,231 recoverable**" → one click → appeal letter generates and self-signs. Nutrient extracts line items and redacts PHI before anything hits an LLM; SerpApi pulls real pricing and payer policy; Doctavian generates and signs; Foxit renders the annotated original; Xano is the backend — and "the patient billing portal" is a perfect answer to *rebuild a SaaS tool you hate*.

Why it wins Round 1: ~100M Americans carry medical debt, the startup case is already proven (Goodbill, Claimable), and progress is visible in every frame of the demo.

#### 2. Lookalike — the scam interceptor for your parents
**Reach: $10,000** · name.com · SerpApi · Nutrient · Doctavian · Xano

Forward a suspicious letter, email, or link. Ten seconds later you know whether it's a scam and exactly why.

*The demo:* paste `chase-secure-verify.com` → registered 3 days ago, DNS points to a bulk host, no matching business record, 41 sibling typosquats still available → **96% scam** → generates a one-page explainer for the family plus a signed FTC complaint. name.com's ZoneCheck and DNS endpoints do the domain forensics — this is one of very few concepts where the domain API is *genuinely* the core, which is exactly what that track's judges are looking for and what most entrants will fake.

Elder fraud runs ~$3.4B/year. The demo has real "call your mom" energy.

#### 3. Mirror — your face in 20 years, with and without sunscreen
**Reach: $9,000** · Perfect Corp · SerpApi · Doctavian · Xano

*The demo:* webcam → Skin Analysis returns 14 quantified concerns and a skin age → split-screen aging simulation, protected vs. unprotected → silence in the room → SerpApi surfaces actual products at actual prices → Doctavian generates a dermatologist-ready report.

Both endpoints exist off the shelf. This is the highest visual impact per hour of work on the entire board, and Perfect Corp is the partner sponsor paying **all cash**. Buildable by one person in a day or two.

### Tier 2 — strong, but crowded or narrower

#### 4. Incorporate — idea to registered company in five minutes
**Reach: $11,000** · SerpApi · name.com · Doctavian · Nutrient · Xano · Foxit
Market and competitor research → domain search and actual registration → operating agreement and founder vesting, generated and signed. The widest reach on the board and a satisfying single-funnel demo. Downside: "AI startup wizard" is a well-worn hackathon shape — it needs a genuinely sharp edge to stand out.

#### 5. Lease — know your tenant rights before you sign
**Reach: $9,000** · Nutrient · SerpApi · Doctavian · Foxit · Xano
Upload a lease; it flags clauses that are illegal *in your jurisdiction* (SerpApi pulls the local statute) and drafts the demand letter. Emotionally strong, slightly narrower than Denial.

#### 6. When I'm Gone — the folder your family will need
**Reach: $8,000** · Nutrient · Doctavian · name.com · Foxit · Xano
Documents, accounts, domains, and instructions in one vault; generates and signs a letter to each person; handles digital-estate and domain transfer. The most emotionally powerful demo here, and the easiest to get wrong — the line between moving and maudlin is thin.

#### 7. Grantly — grant discovery and drafting for small nonprofits
**Reach: $8,000** · SerpApi · Nutrient · Doctavian · Xano
Finds open grants, parses the RFPs, drafts and signs the applications. Obvious buyer, obvious ROI, less visually dramatic.

#### 8. Rebuild the DMV
**Reach: $6,000** · Xano · Nutrient · Doctavian · Foxit
The Xano brief taken literally and at maximum scope: a government form portal that's a conversation instead of a 40-page PDF. The best pure play for that specific prize.

### Tier 3 — arbitrage: best cash per hour, least glory

#### 9. Cloud Bill Autopsy
**Reach: $6,500** · Apptio · SerpApi · Nutrient · Doctavian
Ingest a cloud invoice, benchmark line items against public pricing, generate a signed savings memo for the CFO. Unsexy, and that's the point — Apptio's field will be nearly empty.

#### 10. Spec to Suite
**Reach: $3,500** · useBruno · Wundergraph · Nutrient
Drop in a PDF API spec, get back a runnable Bruno collection and a federated Cosmo subgraph. Bruno's OpenAPI sync and `bru.ctx` custom apps plus Cosmo's schema registry make this genuinely elegant rather than forced, and Nutrient parses the spec. Almost certainly the thinnest field in the hackathon — two $1,000 pots that most of 544 participants will ignore entirely.

#### 11. Contract Diff
**Reach: $6,000** · Nutrient · Foxit · Doctavian · Xano
Deterministic redline between two contract versions with a full audit trail. Boring — but Nutrient's brief literally asks for "deterministic, auditable output," so this is writing to the rubric.

### Tier 4 — high emotion, higher risk

#### 12. First Day
**Reach: $6,500** · Nutrient · SerpApi · Doctavian · Foxit
Photograph any official letter; get it explained in your language and the response form filled out. Enormous emotional weight. Be careful to stay on the explanation side of the line and never give legal advice.

#### 13. Closet
**Reach: $8,000** · Perfect Corp · SerpApi · Xano
Try on a secondhand listing before you buy it. Fun, visual, sustainable — and a commercially crowded space that judges have seen before.

#### 14. Unsubscribe
**Reach: $8,000** · SerpApi · Nutrient · Doctavian · Xano
The cancellation agent: parses your bank statement for forgotten subscriptions, finds each company's actual cancellation policy, generates and signs the cancellation letters. The funniest demo on this list — and judges remembering you is worth more than it sounds.

---

## Recommendation

**Build Denial as the primary.** It has the best combination of the four things that matter: a problem every judge has personally suffered, a demo with a number that lands like a punch, five tracks it can enter without a single forced integration, and a startup story you can answer in one sentence. The Round 1 criteria — progress, real problem, feasibility — are all layups.

**If you'd rather chase breadth, build Lookalike instead.** It reaches $10,000 across six tracks and is the only concept on the list that makes name.com's $2,000 track genuinely winnable, because the domain API is doing real forensic work rather than being name-dropped.

**Then run Mirror in parallel as a second submission.** Perfect Corp is the partner sponsor, pays $2,500 in straight cash, and both endpoints Mirror needs already exist. One person can build it in a day. It's the cheapest incremental expected value available — and it covers the visual-spectacle angle that Denial, being a document tool, structurally cannot.

**If you have a fifth person with a spare afternoon, have them ship Spec to Suite.** Two $1,000 pots that most of the field will leave uncontested.

### Tactics that matter more than the idea

- **Get every API key before Aug 17.** Nutrient, SerpApi, and Foxit are instant and free. Perfect Corp, Doctavian, and Xano need signup flows that can eat a day. You have five days of runway before launch — spend them on credentials, not code.
- **Write a separate "where this sponsor does essential work" paragraph for every track you enter.** Sponsors judge integration depth and they read these. One generic writeup submitted six times is how strong projects lose thin fields.
- **Budget a full day for the demo video.** Most tracks want 2–4 minutes; Perfect Corp wants 1–3. It is the single highest-leverage hour of the whole hackathon and the thing every team under-invests in.
- **Build the audit view.** Nutrient's brief asks for deterministic, auditable output with a human in the loop. A visible diff/confidence/override panel is a feature you'd want anyway, and it converts one track from a maybe into a likely.
- **Frame Xano correctly.** The track is "rebuild a SaaS tool you *hate*." Name the incumbent explicitly in the writeup — the patient billing portal, the DMV site — and tell the build story they ask for.
- **Be in the room on Sept 2–3.** Winners are announced live, several tracks require exit interviews, and 80+ judges circulating in person is not a channel you want to skip.
