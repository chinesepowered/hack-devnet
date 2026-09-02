"use client";

import type { Finding, LineItem } from "@/lib/types";
import { ConfidenceBar, money } from "./primitives";

/**
 * The extracted bill.
 *
 * Rows stream in as they are parsed, each one carrying its own extraction
 * confidence. Once the audit runs, disputed rows are struck through and
 * tagged, so the whole argument is legible in one table.
 */
export function BillTable({
  lines,
  findings,
  revealCount,
  highlightReview,
}: {
  lines: LineItem[];
  findings: Finding[];
  /** How many rows to show — drives the streaming-in effect. */
  revealCount: number;
  highlightReview: boolean;
}) {
  const findingByLine = new Map<string, Finding>();
  for (const f of findings) {
    for (const id of f.lineIds) if (!findingByLine.has(id)) findingByLine.set(id, f);
  }

  /**
   * A finding covering several lines carries one total. Showing that total on
   * every row it touches reads as if the money were disputed several times, so
   * split it across the rows in proportion to what each was charged.
   */
  const shareOf = (finding: Finding, line: LineItem): number => {
    if (finding.lineIds.length === 1) return finding.disputedAmount;
    const covered = finding.lineIds
      .map((id) => lines.find((l) => l.id === id)?.charged ?? 0)
      .reduce((a, b) => a + b, 0);
    if (covered <= 0) return finding.disputedAmount / finding.lineIds.length;
    return (line.charged / covered) * finding.disputedAmount;
  };

  const visible = lines.slice(0, revealCount);

  return (
    <div className="scroll-thin max-h-[520px] overflow-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="eyebrow text-muted">
            <th className="border-b border-line px-4 py-2.5 text-left font-semibold">Code</th>
            <th className="border-b border-line px-3 py-2.5 text-left font-semibold">Description</th>
            <th className="border-b border-line px-3 py-2.5 text-right font-semibold">Qty</th>
            <th className="border-b border-line px-3 py-2.5 text-right font-semibold">Charge</th>
            <th className="border-b border-line px-4 py-2.5 text-left font-semibold">Extraction</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((line, i) => {
            const finding = findingByLine.get(line.id);
            const flagged = highlightReview && line.needsReview;
            return (
              <tr
                key={line.id}
                className="animate-rise border-b border-line/60 last:border-0"
                style={{ animationDelay: `${Math.min(i, 14) * 45}ms` }}
              >
                <td className="px-4 py-2.5 align-top">
                  <span className="tnum font-medium">{line.code}</span>
                  <div className="eyebrow mt-0.5 text-muted">{line.codeSystem}</div>
                </td>
                <td className="px-3 py-2.5 align-top">
                  <span className={finding ? "text-muted line-through decoration-alert/70" : ""}>
                    {line.description}
                  </span>
                  {finding && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="eyebrow rounded border border-alert/45 bg-alert/10 px-1.5 py-px text-alert">
                        {finding.kind.replace(/_/g, " ")}
                      </span>
                      <span className="tnum text-[11px] text-alert">
                        −{money(shareOf(finding, line), true)}
                      </span>
                    </div>
                  )}
                  {line.reviewedBy && (
                    <div className="eyebrow mt-1 text-info">confirmed by {line.reviewedBy}</div>
                  )}
                </td>
                <td className="tnum px-3 py-2.5 text-right align-top">{line.units}</td>
                <td className="tnum px-3 py-2.5 text-right align-top font-medium">
                  {money(line.charged, true)}
                </td>
                <td
                  className={`px-4 py-2.5 align-top ${flagged ? "animate-pulse-warn rounded border" : ""}`}
                >
                  <ConfidenceBar value={line.confidence} delay={Math.min(i, 14) * 45} />
                  {flagged && (
                    <div className="eyebrow mt-1 text-warn">needs review</div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
