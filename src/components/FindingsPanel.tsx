"use client";

import { useState } from "react";

import { FINDING_LABEL, type Finding, type LineItem, type PriceEvidence } from "@/lib/types";
import { money, SeverityDot } from "./primitives";

/** How many findings to show before folding the rest away. */
const TOP_N = 6;

/** What the audit found, ordered by how much money is at stake. */
export function FindingsPanel({
  findings,
  lines,
  revealCount,
}: {
  findings: Finding[];
  lines: LineItem[];
  revealCount: number;
}) {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const [expanded, setExpanded] = useState(false);

  // The tail is real money but not the story — keep it one click away so the
  // headline findings stay on one screen.
  const revealed = findings.slice(0, revealCount);
  const shown = expanded ? revealed : revealed.slice(0, TOP_N);
  const hidden = findings.slice(shown.length);
  const hiddenTotal = hidden.reduce((s, f) => s + f.disputedAmount, 0);

  return (
    <div className="divide-y divide-line">
      {shown.map((f, i) => (
        <article
          key={f.id}
          className="animate-rise px-5 py-4"
          style={{ animationDelay: `${Math.min(i, 8) * 90}ms` }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityDot severity={f.severity} />
                <span className="eyebrow text-muted">{FINDING_LABEL[f.kind]}</span>
                {f.confidence < 0.7 && (
                  <span className="eyebrow rounded border border-warn/45 bg-warn/10 px-1.5 py-px text-warn">
                    needs records
                  </span>
                )}
              </div>
              <h3 className="mt-1.5 text-[14px] font-bold leading-snug">{f.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-dim">{f.rationale}</p>

              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {f.lineIds.map((id) => {
                  const l = byId.get(id);
                  if (!l) return null;
                  return (
                    <span
                      key={id}
                      className="tnum rounded border border-line-strong bg-surface-2 px-2 py-0.5 text-[11px] text-muted"
                    >
                      {l.code} · {money(l.charged, true)}
                    </span>
                  );
                })}
              </div>

              <p className="eyebrow mt-2.5 leading-relaxed text-muted">{f.citation}</p>
            </div>

            <div className="shrink-0 text-right">
              <div className="tnum text-[17px] font-bold text-alert">
                −{money(f.disputedAmount, true)}
              </div>
              <div className="eyebrow mt-0.5 text-muted">
                {Math.round(f.confidence * 100)}% confident
              </div>
            </div>
          </div>
        </article>
      ))}

      {hidden.length > 0 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-3 text-left transition hover:bg-surface-2"
        >
          <span className="text-[13px] font-semibold text-ink-dim">
            {expanded
              ? "Collapse the smaller findings"
              : `${hidden.length} more finding${hidden.length === 1 ? "" : "s"}`}
          </span>
          <span className="tnum text-[13px] font-bold text-alert">
            {expanded ? "−" : `−${money(hiddenTotal, true)}`}
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * Price evidence.
 *
 * The bar comparison is the emotional beat of this stage: a charge bar that
 * runs the full width beside a reference bar that is barely visible tells the
 * story faster than any sentence.
 */
export function EvidencePanel({
  evidence,
  revealCount,
}: {
  evidence: PriceEvidence[];
  revealCount: number;
}) {
  const shown = evidence.slice(0, revealCount);

  return (
    <div className="divide-y divide-line">
      {shown.map((e, i) => {
        const max = Math.max(e.charged, e.marketMedian, e.referenceRate, 1);
        const bar = (value: number, color: string, delay: number) => (
          <span className="relative block h-2 flex-1 overflow-hidden rounded-full bg-line">
            <span
              className="animate-grow-x absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${Math.max(1.5, (value / max) * 100)}%`,
                background: color,
                animationDelay: `${delay}ms`,
              }}
            />
          </span>
        );

        return (
          <article
            key={e.lineId}
            className="animate-rise px-5 py-4"
            style={{ animationDelay: `${Math.min(i, 8) * 90}ms` }}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[13px] font-semibold">
                <span className="tnum text-muted">{e.code}</span> · {e.description}
              </h3>
              {e.markupMultiple > 0 && (
                <span className="tnum rounded-full border border-alert/45 bg-alert/10 px-2 py-0.5 text-[12px] font-bold text-alert">
                  {e.markupMultiple.toFixed(0)}× reference
                </span>
              )}
            </div>

            <div className="mt-3 space-y-1.5">
              {[
                ["Billed to patient", e.charged, "var(--alert)"],
                ["Market median", e.marketMedian, "var(--warn)"],
                ["Published reference", e.referenceRate, "var(--accent)"],
              ].map(([label, value, color], j) => (
                <div key={label as string} className="flex items-center gap-3">
                  <span className="w-36 shrink-0 text-[12px] text-muted">{label as string}</span>
                  {bar(value as number, color as string, Math.min(i, 8) * 90 + j * 110)}
                  <span className="tnum w-24 shrink-0 text-right text-[12px] font-medium">
                    {money(value as number, true)}
                  </span>
                </div>
              ))}
            </div>

            {e.sources.length > 0 && (
              <details className="mt-3">
                <summary className="eyebrow cursor-pointer text-muted transition hover:text-ink">
                  {e.sources.length} price{e.sources.length === 1 ? "" : "s"} observed
                </summary>
                <ul className="mt-2 space-y-1">
                  {e.sources.map((s, k) => (
                    <li key={k} className="flex items-baseline justify-between gap-3 text-[12px]">
                      <span className="min-w-0 truncate text-ink-dim">
                        {s.url ? (
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="underline decoration-line-strong underline-offset-2 hover:decoration-accent"
                          >
                            {s.label}
                          </a>
                        ) : (
                          s.label
                        )}
                      </span>
                      <span className="tnum shrink-0">{money(s.price, true)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </article>
        );
      })}
    </div>
  );
}
