"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api, fileToBase64, sleep, type SampleSummary, type StageInfo } from "@/lib/client";
import type { CaseRecord } from "@/lib/types";
import { BillTable } from "./BillTable";
import { EvidencePanel, FindingsPanel } from "./FindingsPanel";
import { LetterPanel, SignGate } from "./LetterPanel";
import { Button, CountUp, money, Panel, Spinner } from "./primitives";
import { ReviewGate } from "./ReviewGate";
import { TrailRail, useVendorStatuses, VendorBar } from "./Rails";

type Phase =
  | "intake"
  | "extracting"
  | "review"
  | "auditing"
  | "benchmarking"
  | "drafting"
  | "preparing"
  | "signing"
  | "done";

const STEPS = [
  { key: "extract", label: "Extract", vendor: "Nutrient DWS" },
  { key: "review", label: "Review", vendor: "Human" },
  { key: "audit", label: "Audit", vendor: "LLM" },
  { key: "benchmark", label: "Benchmark", vendor: "SerpApi" },
  { key: "draft", label: "Draft", vendor: "Doctavian" },
  { key: "sign", label: "Sign", vendor: "Foxit eSign" },
] as const;

const PHASE_STEP: Record<Phase, number> = {
  intake: -1,
  extracting: 0,
  review: 1,
  auditing: 2,
  benchmarking: 3,
  drafting: 4,
  preparing: 5,
  signing: 5,
  done: 6,
};

/** Beat between stages so a human can follow what is happening. */
const PACE = 850;

/** Reveal a list one item at a time. */
function useReveal(target: number, stepMs = 90) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (target === 0) {
      setCount(0);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCount(target);
      return;
    }
    setCount(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setCount(i);
      if (i >= target) clearInterval(id);
    }, stepMs);
    return () => clearInterval(id);
  }, [target, stepMs]);
  return count;
}

export function Studio() {
  const { statuses, refresh, toggle } = useVendorStatuses();
  const [samples, setSamples] = useState<SampleSummary[]>([]);
  const [record, setRecord] = useState<CaseRecord | null>(null);
  const [phase, setPhase] = useState<Phase>("intake");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState<StageInfo[]>([]);
  const [summary, setSummary] = useState<string>("");
  const [agentRefusal, setAgentRefusal] = useState<string | null>(null);
  const [autoPilot, setAutoPilot] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.samples().then((s) => setSamples(s.samples)).catch(() => {});
  }, []);

  const lineReveal = useReveal(record?.lines.length ?? 0, 55);
  const findingReveal = useReveal(
    phase === "auditing" || PHASE_STEP[phase] > 2 ? (record?.findings.length ?? 0) : 0,
    130,
  );
  const evidenceReveal = useReveal(
    PHASE_STEP[phase] >= 3 ? (record?.evidence.length ?? 0) : 0,
    130,
  );

  const addStage = (s: StageInfo) => setStages((prev) => [...prev, s]);

  /**
   * Follow the pipeline down the page.
   *
   * The run produces a lot of vertical content and a presenter should never be
   * hunting for the panel that just appeared, so each new stage scrolls itself
   * into view.
   */
  const panelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const setPanel = (key: string) => (el: HTMLDivElement | null) => {
    panelRefs.current[key] = el;
  };

  useEffect(() => {
    const target: Partial<Record<Phase, string>> = {
      review: "review",
      auditing: "findings",
      benchmarking: "evidence",
      drafting: "letter",
      preparing: "sign",
      signing: "sign",
      done: "sign",
    };
    const key = target[phase];
    if (!key) return;
    // Let the panel mount and its entry animation start before scrolling.
    const t = setTimeout(() => {
      panelRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 320);
    return () => clearTimeout(t);
  }, [phase]);

  /** Everything after the human review gate runs unattended. */
  const runToSignature = useCallback(
    async (caseId: string) => {
      try {
        setPhase("auditing");
        const audited = await api.audit(caseId);
        setRecord(audited.case);
        setSummary(audited.summary);
        addStage(audited.stage);
        await sleep(PACE * 2);

        setPhase("benchmarking");
        const benched = await api.benchmark(caseId);
        setRecord(benched.case);
        addStage(benched.stage);
        await sleep(PACE * 2);

        setPhase("drafting");
        const drafted = await api.generate(caseId);
        setRecord(drafted.case);
        addStage(drafted.stage);
        await sleep(PACE * 2.5);

        setPhase("preparing");
        const prepared = await api.signRequest(caseId, "patient@example.com");
        setRecord(prepared.case);
        addStage(prepared.stage);
        await sleep(PACE);

        setPhase("signing");
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const start = useCallback(
    async (input: { sampleId?: string; pdfBase64?: string; filename?: string }, auto = false) => {
      setError(null);
      setStages([]);
      setSummary("");
      setAgentRefusal(null);
      setAutoPilot(auto);
      setBusy(true);
      setPhase("extracting");
      try {
        const opened = await api.open(input);
        setRecord(opened.case);
        addStage(opened.stage);
        await sleep(PACE * 2);

        if (opened.needsReview.length > 0) {
          setPhase("review");
          setBusy(false);
          if (auto) {
            // Auto-pilot still passes through the gate; it just answers for you.
            await sleep(2400);
            const reviewed = await api.review(
              opened.case.id,
              "Dana Okafor",
              opened.needsReview.map((lineId) => ({ lineId, action: "confirm" as const })),
            );
            setRecord(reviewed.case);
            await sleep(PACE);
            void runToSignature(opened.case.id);
          }
        } else {
          void runToSignature(opened.case.id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("intake");
        setBusy(false);
      }
    },
    [runToSignature],
  );

  const submitReview = async (
    reviewer: string,
    decisions: Array<{ lineId: string; action: "confirm" | "correct" | "remove"; charged?: number; units?: number }>,
  ) => {
    if (!record) return;
    setBusy(true);
    try {
      const reviewed = await api.review(record.id, reviewer, decisions);
      setRecord(reviewed.case);
      await sleep(PACE);
      void runToSignature(record.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const sign = async (typed: string) => {
    if (!record) return;
    setBusy(true);
    try {
      const signed = await api.signApply(record.id, typed);
      setRecord(signed.case);
      addStage(signed.stage);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /** Prove the boundary holds by having the agent try to sign. */
  const agentAttempt = async () => {
    if (!record) return;
    try {
      await api.signApplyAsAgent(record.id);
      setAgentRefusal("The boundary did not hold — this should not happen.");
    } catch (err) {
      setAgentRefusal(err instanceof Error ? err.message : String(err));
    }
  };

  /**
   * Auto-pilot signs once, and only once.
   *
   * `sign()` clears `busy` on failure while leaving the phase at "signing", so
   * without this guard a rejected signature re-triggers the effect and retries
   * forever — a request loop that hammers the server in the middle of a demo.
   * One attempt per case; if it fails, the error shows and the button is there.
   */
  const autoSigned = useRef<string | null>(null);
  useEffect(() => {
    if (!autoPilot || phase !== "signing" || !record || busy) return;
    if (autoSigned.current === record.id) return;
    autoSigned.current = record.id;
    const t = setTimeout(() => void sign(record.meta.patientName), 2600);
    return () => clearTimeout(t);
    // sign is recreated each render; the ref above is what bounds this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPilot, phase, record?.id, busy]);

  // Keyboard shortcuts, so the demo needs no mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
      if (e.key === "d" && phase === "intake" && samples[0]) {
        void start({ sampleId: samples[0].id }, true);
      }
      if (e.key === "r") window.location.reload();
      if (e.key === "l") document.documentElement.classList.toggle("light");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, samples, start]);

  const step = PHASE_STEP[phase];
  const disputed = record?.disputedTotal ?? 0;
  const billed = record?.billedTotal ?? 0;

  return (
    <div className="mx-auto flex min-h-screen max-w-[1500px] flex-col px-5 py-5">
      <TopBar statuses={statuses} onToggle={toggle} showReset={phase !== "intake"} />

      {phase === "intake" ? (
        <Intake
          samples={samples}
          onPick={(id) => void start({ sampleId: id })}
          onDemo={(id) => void start({ sampleId: id }, true)}
          onUpload={async (file) => {
            const pdfBase64 = await fileToBase64(file);
            void start({ pdfBase64, filename: file.name });
          }}
          fileInput={fileInput}
          error={error}
        />
      ) : (
        <div className="mt-4 grid flex-1 gap-4 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0 space-y-4">
            <Stepper current={step} />

            {record && step >= 2 && (
              <SavingsBanner
                billed={billed}
                disputed={disputed}
                findingCount={record.findings.length}
                summary={summary}
                settled={phase === "done"}
              />
            )}

            {error && (
              <div className="rounded-lg border border-alert/45 bg-alert/10 px-4 py-3 text-[13px] text-alert">
                {error}
              </div>
            )}

            {record && (
              <Panel
                eyebrow={`${record.meta.provider} · account ${record.meta.accountNumber}`}
                title={`${record.lines.length} line items · ${money(billed)} billed`}
                right={<StageBadge stages={stages} name="extract" />}
              >
                <BillTable
                  lines={record.lines}
                  findings={record.findings}
                  revealCount={lineReveal}
                  highlightReview={phase === "review"}
                />
              </Panel>
            )}

            {/* Drop the gate the moment nothing is left to confirm, so it never
                renders as "confirm 0 fields" between the answer and the next stage. */}
            {phase === "review" && record?.lines.some((l) => l.needsReview) && (
              <Panel
                ref={setPanel("review")}
                eyebrow="Human in the loop"
                title="Confirm what the parser was unsure about"
              >
                <ReviewGate lines={record.lines} onSubmit={submitReview} busy={busy} />
              </Panel>
            )}

            {record && record.findings.length > 0 && (
              <Panel
                ref={setPanel("findings")}
                eyebrow="Billing audit"
                title={`${record.findings.length} issues · ${money(disputed, true)} disputed`}
                right={<StageBadge stages={stages} name="audit" />}
              >
                <FindingsPanel
                  findings={record.findings}
                  lines={record.lines}
                  revealCount={findingReveal}
                />
              </Panel>
            )}

            {record && record.evidence.length > 0 && (
              <Panel
                ref={setPanel("evidence")}
                eyebrow="Price evidence"
                title="What everyone else charges for the same codes"
                right={<StageBadge stages={stages} name="benchmark" />}
              >
                <EvidencePanel evidence={record.evidence} revealCount={evidenceReveal} />
              </Panel>
            )}

            {record?.document && (
              <Panel
                ref={setPanel("letter")}
                eyebrow="Generated document"
                title={record.document.title}
                right={<StageBadge stages={stages} name="generate" />}
              >
                <LetterPanel record={record} />
              </Panel>
            )}

            {record?.signature && (
              <Panel
                ref={setPanel("sign")}
                eyebrow="Signing boundary"
                title={phase === "done" ? "Signed" : "Ready for a human signature"}
                right={<StageBadge stages={stages} name="sign-request" />}
              >
                <SignGate
                  record={record}
                  onSign={sign}
                  onAgentAttempt={agentAttempt}
                  busy={busy}
                  agentRefusal={agentRefusal}
                />
              </Panel>
            )}

            {busy && step < 5 && (
              <div className="flex items-center gap-2 px-1 text-[13px] text-muted">
                <Spinner /> working…
              </div>
            )}
          </div>

          <aside className="min-w-0">
            <Panel
              eyebrow="Audit trail"
              title="Every step, in order"
              className="lg:sticky lg:top-5 lg:max-h-[calc(100vh-40px)] lg:overflow-hidden"
            >
              {record && <TrailRail trail={record.trail} />}
            </Panel>
          </aside>
        </div>
      )}
    </div>
  );
}

function TopBar({
  statuses,
  onToggle,
  showReset,
}: {
  statuses: ReturnType<typeof useVendorStatuses>["statuses"];
  onToggle: ReturnType<typeof useVendorStatuses>["toggle"];
  showReset: boolean;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
      <a href="/" className="flex items-center gap-2.5">
        <ShieldMark />
        <span>
          <span className="block text-[17px] font-extrabold tracking-tight">BillShield</span>
          <span className="eyebrow block text-muted">Medical bill dispute agent</span>
        </span>
      </a>
      <div className="flex flex-wrap items-center gap-3">
        <VendorBar statuses={statuses} onToggle={onToggle} interactive />
        {showReset && (
          <button
            onClick={() => window.location.reload()}
            className="eyebrow text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            New case
          </button>
        )}
        <a href="/judges" className="eyebrow text-muted underline-offset-4 hover:text-ink hover:underline">
          Judges
        </a>
      </div>
    </header>
  );
}

function ShieldMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2.5 4.5 5.5v6c0 4.6 3.1 8.7 7.5 10 4.4-1.3 7.5-5.4 7.5-10v-6L12 2.5Z"
        stroke="var(--accent)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M8.4 12.2l2.5 2.5 4.7-5"
        stroke="var(--accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap items-stretch gap-1.5">
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={s.key}
            className={`relative flex-1 overflow-hidden rounded-lg border px-3 py-2 transition ${
              active
                ? "border-accent/60 bg-accent/10"
                : done
                  ? "border-line-strong bg-surface"
                  : "border-line bg-surface/40"
            } ${active ? "stage-sweep" : ""}`}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={`eyebrow ${active ? "text-accent" : done ? "text-ink-dim" : "text-muted"}`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span
                className={`text-[13px] font-semibold ${active ? "text-ink" : done ? "text-ink-dim" : "text-muted"}`}
              >
                {s.label}
              </span>
            </div>
            <div className="eyebrow mt-0.5 truncate text-muted">{s.vendor}</div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Stage timing only.
 *
 * The live/local chip used to sit here too. It is redundant in this view — the
 * audit trail beside it already names the system that ran each stage and why —
 * and it read as an apology mid-demo. Provenance still lives in the trail, in
 * the signed PDF's audit page, and on /judges.
 */
function StageBadge({ stages, name }: { stages: StageInfo[]; name: string }) {
  const stage = stages.find((s) => s.name === name);
  if (!stage) return null;
  return (
    <span className="tnum text-[11px] text-muted" title={stage.note}>
      {stage.ms}ms
    </span>
  );
}

function SavingsBanner({
  billed,
  disputed,
  findingCount,
  summary,
  settled,
}: {
  billed: number;
  disputed: number;
  findingCount: number;
  summary: string;
  settled: boolean;
}) {
  const corrected = Math.max(0, billed - disputed);
  const pct = billed > 0 ? (disputed / billed) * 100 : 0;

  return (
    <section
      className={`animate-rise overflow-hidden rounded-xl border ${
        settled ? "border-accent/55 bg-accent/8" : "border-line bg-surface"
      }`}
      style={{ boxShadow: "var(--shadow-sm)" }}
    >
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-[auto_1fr] sm:items-center">
        <div>
          <div className="eyebrow text-muted">{settled ? "Recovered" : "Challenged so far"}</div>
          <CountUp to={disputed} className="text-[42px] leading-none font-extrabold text-accent" />
          <div className="eyebrow mt-1 text-muted">
            {pct.toFixed(0)}% of the bill · {findingCount} issues
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="eyebrow w-20 shrink-0 text-muted">Billed</span>
            <span className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-line">
              <span className="absolute inset-0 rounded-full bg-alert/70" />
            </span>
            <span className="tnum w-24 shrink-0 text-right text-[13px] font-semibold">
              {money(billed)}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="eyebrow w-20 shrink-0 text-muted">You owe</span>
            <span className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-line">
              <span
                className="animate-grow-x absolute inset-y-0 left-0 rounded-full bg-accent"
                style={{ width: `${Math.max(2, (corrected / Math.max(billed, 1)) * 100)}%` }}
              />
            </span>
            <span className="tnum w-24 shrink-0 text-right text-[13px] font-semibold text-accent">
              {money(corrected)}
            </span>
          </div>
          {summary && <p className="pt-1 text-[12px] leading-relaxed text-muted">{summary}</p>}
        </div>
      </div>
    </section>
  );
}

function Intake({
  samples,
  onPick,
  onDemo,
  onUpload,
  fileInput,
  error,
}: {
  samples: SampleSummary[];
  onPick: (id: string) => void;
  onDemo: (id: string) => void;
  onUpload: (file: File) => void;
  fileInput: React.RefObject<HTMLInputElement | null>;
  error: string | null;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <main className="flex flex-1 flex-col justify-center py-10">
      <div className="mx-auto w-full max-w-3xl text-center">
        <p className="eyebrow animate-rise text-accent">
          Four in five hospital bills contain an error
        </p>
        <h1
          className="animate-rise mt-3 text-[clamp(2rem,5vw,3.3rem)] leading-[1.05] font-extrabold"
          style={{ animationDelay: "80ms" }}
        >
          Nobody reads the itemized bill.
          <br />
          <span className="text-accent">This does.</span>
        </h1>
        <p
          className="animate-rise mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-ink-dim"
          style={{ animationDelay: "160ms" }}
        >
          BillShield reads a hospital statement line by line, finds the charges that are duplicated,
          unbundled, or unsupported, proves the prices against published rates, and hands you a
          signed dispute letter with a trail of every step.
        </p>

        <div
          className="animate-rise mt-9 grid gap-3 sm:grid-cols-3"
          style={{ animationDelay: "240ms" }}
        >
          {samples.map((s, i) => (
            <button
              key={s.id}
              onClick={() => onPick(s.id)}
              className="group rounded-xl border border-line bg-surface p-4 text-left transition hover:-translate-y-0.5 hover:border-accent/60"
              style={{ boxShadow: "var(--shadow-sm)" }}
            >
              <div className="flex h-9 items-center text-2xl leading-none">{s.glyph}</div>
              <div className="mt-2 text-[14px] font-bold group-hover:text-accent">{s.label}</div>
              <div className="tnum mt-0.5 text-[12px] text-muted">
                {money(s.total)} · {s.lineCount} lines
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-muted">{s.blurb}</p>
            </button>
          ))}
        </div>

        <div
          className="animate-rise mt-3 flex flex-col items-center gap-3"
          style={{ animationDelay: "320ms" }}
        >
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files[0];
              if (file) onUpload(file);
            }}
            onClick={() => fileInput.current?.click()}
            className={`w-full cursor-pointer rounded-xl border border-dashed px-5 py-6 transition ${
              dragging ? "border-accent bg-accent/8" : "border-line-strong hover:border-accent/60"
            }`}
          >
            <p className="text-[13px] text-ink-dim">
              …or drop your own bill here <span className="text-muted">(PDF)</span>
            </p>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUpload(file);
              }}
            />
          </div>

          {samples[0] && (
            <Button onClick={() => onDemo(samples[0].id)} className="px-6 py-2.5">
              Run the full demo
              <kbd className="eyebrow rounded border border-current/30 px-1.5 py-px opacity-70">
                D
              </kbd>
            </Button>
          )}
        </div>

        {error && (
          <p className="mt-4 text-[13px] text-alert" role="alert">
            {error}
          </p>
        )}

        <p className="eyebrow mt-8 text-muted">
          Press L for light mode · R to reset · every vendor has a working fallback
        </p>
      </div>
    </main>
  );
}
