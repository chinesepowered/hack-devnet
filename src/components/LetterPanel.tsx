"use client";

import { useEffect, useRef, useState } from "react";

import type { CaseRecord } from "@/lib/types";
import { Button, money, Spinner } from "./primitives";

/**
 * The letter, as paper.
 *
 * The body types itself in on first render. It is the moment the audience
 * realises the pipeline produced a real document rather than a summary screen,
 * so it is worth the animation.
 */
export function LetterPanel({ record }: { record: CaseRecord }) {
  const doc = record.document;
  const [shown, setShown] = useState(0);
  const sheetRef = useRef<HTMLPreElement>(null);
  const body = doc?.bodyText ?? "";

  useEffect(() => {
    if (!body) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(body.length);
      return;
    }
    let raf = 0;
    const started = performance.now();
    // ~2.2s to lay down the whole letter, regardless of its length.
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / 2200);
      setShown(Math.floor(body.length * t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [body]);

  useEffect(() => {
    const el = sheetRef.current;
    if (el && shown < body.length) el.scrollTop = el.scrollHeight;
  }, [shown, body.length]);

  if (!doc) return null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <span className="eyebrow text-muted">Template branches evaluated</span>
        <span className="tnum rounded-full border border-accent/45 bg-accent/10 px-2 py-0.5 text-[11px] font-bold text-accent">
          {doc.branchesTaken.length}
        </span>
      </div>

      <ul className="scroll-thin max-h-36 space-y-1 overflow-auto border-b border-line bg-surface-2 px-5 py-3">
        {doc.branchesTaken.map((b, i) => (
          <li
            key={i}
            className="animate-slide-in flex gap-2 text-[12px] leading-relaxed text-ink-dim"
            style={{ animationDelay: `${Math.min(i, 10) * 60}ms` }}
          >
            <span className="text-accent">›</span>
            <span className="font-mono">{b}</span>
          </li>
        ))}
      </ul>

      <div className="bg-paper p-5">
        <pre
          ref={sheetRef}
          className="paper-sheet scroll-thin max-h-[440px] overflow-auto rounded-lg px-8 py-7 text-[11.5px] leading-relaxed whitespace-pre-wrap"
        >
          {body.slice(0, shown)}
          {shown < body.length && (
            <span className="inline-block h-3.5 w-1.5 translate-y-0.5 bg-[#1a1f22]" />
          )}
        </pre>
      </div>
    </div>
  );
}

/**
 * The signing ceremony.
 *
 * This is the only control in the app that crosses the signing boundary, and
 * it is deliberately heavyweight: the signer sees the hash of exactly what
 * they are signing before they can sign it.
 */
export function SignGate({
  record,
  onSign,
  onAgentAttempt,
  busy,
  agentRefusal,
}: {
  record: CaseRecord;
  onSign: (typed: string) => void;
  onAgentAttempt: () => void;
  busy: boolean;
  agentRefusal: string | null;
}) {
  const [typed, setTyped] = useState(record.meta.patientName);
  const sig = record.signature;
  if (!sig) return null;

  const signed = sig.status === "signed";
  const corrected = Math.max(0, record.billedTotal - record.disputedTotal);

  return (
    <div className="px-5 py-5">
      {!signed && (
        <div className="mb-5 rounded-lg border border-warn/40 bg-warn/5 px-4 py-3">
          <div className="eyebrow text-warn">The agent stops here</div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-dim">
            Everything up to this point was reversible, so the agent did it unattended. A signature
            is not: it makes a legal assertion in your name and there is no undo. The agent prepared
            the envelope and hashed the document. It has no code path that can sign it.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={onAgentAttempt} className="text-[12px]">
              Let the agent try to sign it
            </Button>
            {agentRefusal && (
              <span className="text-[12px] font-medium text-alert">{agentRefusal}</span>
            )}
          </div>
        </div>
      )}

      <dl className="mb-5 grid gap-x-6 gap-y-2 text-[12px] sm:grid-cols-[auto_1fr]">
        {[
          ["Envelope", sig.envelopeId],
          ["Signer", `${sig.signerName}${sig.signerEmail ? ` · ${sig.signerEmail}` : ""}`],
          ["Document SHA-256", sig.documentHash],
          ["Status", signed ? `signed ${new Date(sig.signedAt!).toLocaleString()}` : "awaiting signature"],
        ].map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="eyebrow text-muted">{k}</dt>
            <dd className="tnum break-all text-ink-dim">{v}</dd>
          </div>
        ))}
      </dl>

      {signed ? (
        <div className="animate-pop rounded-lg border border-accent/40 bg-accent/5 px-5 py-5 text-center">
          <div className="eyebrow text-accent">Signed and sealed</div>
          <p className="mt-2 text-[13px] text-ink-dim">
            The letter, its evidence, and the full processing trail are now one tamper-evident
            document.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <a href={`/api/cases/${record.id}/pdf`} target="_blank" rel="noreferrer">
              <Button>Open the signed letter</Button>
            </a>
            <a href={`/api/cases/${record.id}/pdf?download=1`}>
              <Button variant="ghost">Download PDF</Button>
            </a>
          </div>
        </div>
      ) : (
        <div>
          <label className="eyebrow block text-muted">Sign by typing your name</label>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="mt-2 w-full rounded-lg border-2 border-line-strong bg-surface-2 px-4 py-3 text-[26px] italic focus:border-accent"
            style={{ fontFamily: "var(--font-bricolage)" }}
            placeholder="Your name"
          />
          <p className="mt-2 text-[12px] text-muted">
            By signing you are asserting that the disputed charges are as described. You are
            requesting a corrected balance of{" "}
            <strong className="tnum text-ink">{money(corrected, true)}</strong>.
          </p>
          <Button
            onClick={() => onSign(typed)}
            disabled={busy || typed.trim().length < 2}
            className="mt-4 w-full py-3 text-[14px]"
          >
            {busy ? <Spinner /> : null}
            Sign and send the dispute
          </Button>
        </div>
      )}
    </div>
  );
}
