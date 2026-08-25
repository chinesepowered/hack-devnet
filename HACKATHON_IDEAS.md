# DevNetwork [API + Cloud + AI] Hackathon 2026 — What to Build

Goal: maximize expected cash prize value with something easy to demo and emotionally/visually impactful.

## The strategic insight

The $12,500 overall prize is a lottery ticket (300+ participants, 1 winner). The sponsor
challenges are where the expected value lives: eight separate prize pools, 14 winner slots,
~$13,500 in cash/gift cards — and the niche ones (Doctavian, Foxit, Nutrient, name.com)
historically get very few serious, purpose-built entries. A polished entry aimed straight at a
niche sponsor's brief can plausibly have a 25–50% chance of placing, versus low single digits
for overall.

**The max-EV play is stacking: one coherent product whose pipeline gives 4–5 sponsor APIs each
a genuinely load-bearing role, entered into every one of those challenges — plus an emotional
demo that doubles as an overall-prize lottery ticket.**

Notice the document cluster: Foxit ($700/$300, agent → signed doc), Doctavian ($500/$200,
complex document generation), and Nutrient ($750/$250, extraction/redaction/audit pipelines)
are three separate prize pools that all live in the same workflow. One document-heavy agent can
credibly enter all three if each API owns a distinct stage:

- **Nutrient DWS** = intake: parse/extract with confidence scores, human review in the Viewer, audit trail
- **Doctavian** = output: generate the complex, branching, calculated document
- **Foxit** = the last mile: MCP utility tools + the eSign handoff a human must complete
- **SerpApi** = live web data the AI reasons over
- **Xano** = the backend (auth, data model, workflows, static hosting)

## Prize pools at a glance

| Challenge | 1st | 2nd | Competition level (est.) |
|---|---|---|---|
| Overall Winner | $12,500 cash | — | Very high (everyone) |
| Perfect Corp (AI/AR consumer) | $1,500 | $1,000 | Low–medium (needs their beauty/AR APIs) |
| name.com (domain API) | $1,500 (Amazon GC) | $500 (Amazon GC) | Low (niche) |
| SerpApi (best AI use case) | $1,000 + $1k credits | $500 + credits | Medium–high (easy to add) |
| Xano (rebuild a SaaS tool) | $1,000 + credits | $500 + credits | Medium (actively recruited) |
| Nutrient DWS (document trust) | $750 (Visa) + credits | $250 + credits | Low (niche) |
| Foxit (agent → signed doc) | $700 | $300 | Low (niche) |
| Doctavian (smart doc generation) | $500 + sub | $200 + sub | Very low (tiny sponsor) |

## 13 ideas

1. **BillShield — the medical bill fighter.** Upload a hospital bill → Nutrient extracts line
   items with confidence scores → AI flags upcoding/duplicates → SerpApi benchmarks fair prices
   → Doctavian generates an itemized dispute letter (looping over disputed lines, calculating
   totals) → Foxit eSign sends it for your signature → Xano backend tracks the case. Demo
   moment: a $18,400 bill visibly shrinking to $6,200. Everyone in the room has a medical-bill
   story. **Targets: Nutrient + Doctavian + Foxit + SerpApi + Xano + overall.**

2. **ClaimKit — disaster insurance claim copilot.** After a fire/flood: photos of damage +
   policy PDF → extraction, coverage cross-check, discrepancy detection (Nutrient), replacement
   prices from live shopping data (SerpApi), a complete claim packet (Doctavian), signed and
   submitted (Foxit eSign), human review of low-confidence fields (DWS Viewer). Same 5-stack as
   BillShield with an even more emotional narrative (family rebuilding after a wildfire).

3. **"When I'm Gone" — legacy document agent.** A gentle conversational agent that walks
   someone through a will, advance directive, and letters to loved ones, starting from a plain
   prompt and ending with a signed document — Foxit's brief, verbatim. Doctavian handles the
   branching legal templates (guardianship clauses, per-child bequests, calculations).
   Emotionally heavy in the best way. **Targets: Foxit + Doctavian + overall.**

4. **GlowBack — confidence recovery for chemo/alopecia/burn survivors.** Perfect Corp skin
   analysis tracks recovery; AR try-on for wigs, brows, and makeup; personalized tutorials;
   SerpApi finds the actual products. Visually stunning (live AR on stage) and genuinely
   moving. **Targets: Perfect Corp + SerpApi + overall.**

5. **StyleTwin — AI personal stylist.** Selfie → AI analysis → AR try-on of looks (Perfect
   Corp) → live product/price matching via Google Shopping (SerpApi) → one-tap shopping
   journey. The safest possible match to Perfect Corp's brief; great visuals, less emotional
   punch than GlowBack.

6. **LaunchPage — business idea to live brand in 60 seconds.** Describe your idea → AI
   generates names → SerpApi scans for brand/SERP collisions → name.com API checks
   availability, **registers the domain live on stage**, configures DNS → AI landing page goes
   live at the new domain. Hits name.com's ask for multi-endpoint depth (search + register +
   DNS) exactly. Registering a real domain live is a killer demo moment. **Targets: name.com +
   SerpApi.** Small build — a strong second submission.

7. **PaperTrail — immigration & refugee form navigator.** Documents in any language → OCR
   (Foxit MCP tools) → field extraction with confidence (Nutrient) → standardized government
   forms (Doctavian) → human review (DWS Viewer) → signature. Emotional, regulated, and every
   doc sponsor's API does real work. Heavier build than BillShield.

8. **Freelancer OS — contract to cash.** Scope described in a prompt → contract generated and
   merged (Foxit MCP tools) → eSign handoff → on completion, a compliant EU e-invoice
   (Nutrient — their own suggested use case, France mandate lands Sept 1, mid-event) → Xano
   tracks clients and cash. **Targets: Foxit + Nutrient + Xano.**

9. **Xano rebuild: the HOA / property-management portal everyone hates.** AI answers "can I
   paint my fence?" from the actual CC&Rs, auto-triages maintenance requests, drafts board
   notices. Universally hated software = built-in emotional resonance. **Targets: Xano +
   overall.** (Any "rebuild a SaaS tool" idea works; HOA portals are a crowd-pleaser villain.)

10. **ScamShield for Seniors.** Paste a suspicious text/listing/email → SerpApi verifies the
    business, reviews, phone numbers, and reverse-images the photos → big plain-language
    red/green verdict designed for a 75-year-old. Emotional (protect grandma), trivially
    demoable. **Targets: SerpApi + overall.**

11. **AdoptMe — shelter to home.** Xano-backed shelter management; AI matches adopters to pets;
    adoption contract generated and signed via Foxit eSign. Puppies on screen. **Targets: Xano
    + Foxit.**

12. **Second Look — redact, approve, release.** Records-request pipeline: Nutrient AI redaction
    → human sign-off in the Viewer → digitally signed, tamper-evident release with proof of
    what was removed. It's literally Nutrient's suggested use case — scores maximum on "did DWS
    do the work," less on originality. **Targets: Nutrient.**

13. **GrantWriter for nonprofits.** SerpApi researches funders and prior awards → Doctavian
    generates the full proposal with budget tables that loop and calculate → signed cover
    letter via eSign. **Targets: Doctavian + SerpApi + Foxit.**

## Recommendation

**Primary build: BillShield (#1), with ClaimKit (#2) as the alternate skin on the same
pipeline.** It is the single highest-EV build in this hackathon:

- It enters **five sponsor pools** (Nutrient, Doctavian, Foxit, SerpApi, Xano) whose combined
  1st places are ~$3,950, and three of those pools are niche enough that a purpose-built,
  polished entry is a favorite, not a longshot. Realistic EV in the $1,200–2,000 range —
  roughly 3–5× what a single-track project gets you.
- The demo is one linear, emotional story: bill in → errors found → fair price proven → dispute
  letter out → signed. Every stage is a screen you can show. The finale is a number on screen:
  "You just saved $9,180."
- It's a legitimate overall contender: emotionally impactful, universally relatable,
  demonstrably real APIs doing real work.

**Second submission (if bandwidth allows): GlowBack (#4)** — the Perfect Corp pool ($2,500
across two winners) requires their specific beauty/AR APIs, so it's a separate, thin field, and
their APIs cannot be credibly bolted onto a document product. A separate 1–2 day build with
live AR on stage plus an emotional story is a strong favorite in that pool and a second overall
lottery ticket. If you're a small team, **LaunchPage (#6)** is the cheaper second submission
(~1 day) aimed at name.com's thin field.

**Don't** build one Franken-app that tries to include Perfect Corp AR *and* documents *and*
domains — sponsors judge whether their API is central, and a shoehorned integration reads as
prize-hunting and loses everywhere.

## Execution notes (do these day 1)

- **Read the official rules** for two things: whether one project may be entered into multiple
  sponsor challenges, and whether a team may make multiple submissions. DevNetwork hackathons
  have historically allowed both, but verify before committing to this strategy.
- **Request credentials immediately**: Doctavian requires emailing hello@doctavian.com for API
  access; Perfect Corp uses a redeem-code console; Xano has a signup link + coupon; Nutrient
  credentials are in the challenge listing. Slow credential turnaround is the main schedule risk.
- **Assign each API one unmistakable job** and write the required "one line on where X did the
  real work" for each sponsor. Be ready to defend using three document APIs: intake (Nutrient),
  generation (Doctavian), signature (Foxit) — each doing what it's uniquely built for. For
  Foxit specifically, have a crisp answer on the signing-boundary design question — they
  explicitly reward a defended position.
- **Budget a full day for the demo video.** Every sponsor judges primarily from the 2–4 minute
  video. One narrative, one protagonist, real screens, live API calls, end on the emotional
  number. This is where most of the judging actually happens.
- Note the fine print: name.com "cash" is Amazon gift cards; Nutrient's is Visa gift cards;
  SerpApi/Xano prizes are roughly half cash, half credits.
