"use client";

import { useState } from "react";

import type { LineItem } from "@/lib/types";
import { Button, ConfidenceBar, money, Spinner } from "./primitives";

/**
 * The human-review gate.
 *
 * Extraction is good, not perfect. Rows the parser was unsure about stop here
 * and a person confirms, corrects, or removes each one. Their name and the
 * time go into the audit trail, which is the difference between "a model said
 * so" and a record a regulator can follow.
 */
export function ReviewGate({
  lines,
  onSubmit,
  busy,
}: {
  lines: LineItem[];
  onSubmit: (
    reviewer: string,
    decisions: Array<{
      lineId: string;
      action: "confirm" | "correct" | "remove";
      charged?: number;
      units?: number;
    }>,
  ) => void;
  busy: boolean;
}) {
  const flagged = lines.filter((l) => l.needsReview);
  const [reviewer, setReviewer] = useState("Dana Okafor");
  const [edits, setEdits] = useState<Record<string, { charged: string; units: string; removed: boolean }>>(
    () =>
      Object.fromEntries(
        flagged.map((l) => [
          l.id,
          { charged: String(l.charged), units: String(l.units), removed: false },
        ]),
      ),
  );

  const submit = () => {
    const decisions = flagged.map((l) => {
      const e = edits[l.id];
      if (e?.removed) return { lineId: l.id, action: "remove" as const };
      const charged = Number(e?.charged ?? l.charged);
      const units = Number(e?.units ?? l.units);
      const changed = charged !== l.charged || units !== l.units;
      return changed
        ? { lineId: l.id, action: "correct" as const, charged, units }
        : { lineId: l.id, action: "confirm" as const };
    });
    onSubmit(reviewer.trim() || "Reviewer", decisions);
  };

  return (
    <div className="animate-rise">
      <div className="border-b border-line bg-warn/5 px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[13px] text-ink-dim">
            <strong className="text-ink">{flagged.length} of {lines.length} line items</strong> came
            back below the confidence threshold. The pipeline stops until a person confirms them —
            nothing uncertain reaches the dispute letter unchecked.
          </p>
        </div>
      </div>

      <div className="divide-y divide-line">
        {flagged.map((line, i) => {
          const e = edits[line.id];
          const patch = (p: Partial<typeof e>) =>
            setEdits((prev) => ({ ...prev, [line.id]: { ...prev[line.id], ...p } }));

          return (
            <div
              key={line.id}
              className={`animate-rise px-5 py-4 ${e?.removed ? "opacity-45" : ""}`}
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="tnum text-[13px] font-semibold">{line.code}</span>
                    <ConfidenceBar value={line.confidence} />
                  </div>
                  <p className="mt-1 text-[13px] text-ink-dim">
                    The statement reads{" "}
                    <span className="tnum rounded bg-surface-2 px-1.5 py-0.5 text-ink">
                      &ldquo;{line.description}&rdquo;
                    </span>
                  </p>
                  <p className="mt-1 text-[12px] text-muted">
                    Matched to {line.code} on wording alone. Confirm the quantity and charge against
                    your copy of the bill.
                  </p>
                </div>

                <div className="flex shrink-0 items-end gap-3">
                  <label className="block">
                    <span className="eyebrow block text-muted">Qty</span>
                    <input
                      type="number"
                      value={e?.units ?? line.units}
                      onChange={(ev) => patch({ units: ev.target.value })}
                      disabled={e?.removed}
                      className="tnum mt-1 w-16 rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-right text-[13px]"
                    />
                  </label>
                  <label className="block">
                    <span className="eyebrow block text-muted">Charge</span>
                    <input
                      type="number"
                      step="0.01"
                      value={e?.charged ?? line.charged}
                      onChange={(ev) => patch({ charged: ev.target.value })}
                      disabled={e?.removed}
                      className="tnum mt-1 w-28 rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-right text-[13px]"
                    />
                  </label>
                  <button
                    onClick={() => patch({ removed: !e?.removed })}
                    className="eyebrow rounded border border-line-strong px-2.5 py-2 text-muted transition hover:border-alert hover:text-alert"
                  >
                    {e?.removed ? "Undo" : "Not on bill"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
        <label className="flex items-center gap-2">
          <span className="eyebrow text-muted">Reviewed by</span>
          <input
            value={reviewer}
            onChange={(e) => setReviewer(e.target.value)}
            className="rounded border border-line-strong bg-surface-2 px-3 py-1.5 text-[13px]"
            placeholder="Your name"
          />
        </label>
        <Button onClick={submit} disabled={busy}>
          {busy ? <Spinner /> : null}
          Confirm {flagged.length} field{flagged.length === 1 ? "" : "s"} and continue
        </Button>
      </div>
    </div>
  );
}
