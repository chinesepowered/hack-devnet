import { NextResponse } from "next/server";

import { getCase, trailEntry, updateCase } from "@/lib/adapters/xano";
import type { LineItem } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Stage 2: the human-review gate.
 *
 * Low-confidence extractions do not flow into the audit until a person has
 * looked at them. The reviewer can confirm a row as extracted or correct it,
 * and either way the decision — with their name and the time — lands in the
 * audit trail. This is the step that makes the trail defensible: a regulator
 * reading it can see exactly which values a machine guessed and which a human
 * stood behind.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const record = await getCase(id);
  if (!record) {
    return NextResponse.json({ error: `case ${id} not found` }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    reviewer?: string;
    decisions?: Array<{
      lineId: string;
      action: "confirm" | "correct" | "remove";
      charged?: number;
      units?: number;
      code?: string;
      description?: string;
    }>;
  };

  const reviewer = body.reviewer?.trim();
  if (!reviewer) {
    return NextResponse.json(
      { error: "a reviewer name is required — this decision goes in the audit trail" },
      { status: 400 },
    );
  }

  const decisions = body.decisions ?? [];
  const at = new Date().toISOString();
  const removed = new Set<string>();
  const newTrail = [...record.trail];

  const lines: LineItem[] = record.lines.map((line) => {
    const decision = decisions.find((d) => d.lineId === line.id);
    if (!decision) return line;

    if (decision.action === "remove") {
      removed.add(line.id);
      newTrail.push(
        trailEntry(
          "Human review",
          "nutrient",
          "live",
          `Removed ${line.code} "${line.description}" ($${line.charged.toLocaleString()}) — not present on the source document`,
          reviewer,
        ),
      );
      return line;
    }

    if (decision.action === "correct") {
      const changes: string[] = [];
      if (decision.charged !== undefined && decision.charged !== line.charged) {
        changes.push(`charge $${line.charged.toLocaleString()} → $${decision.charged.toLocaleString()}`);
      }
      if (decision.units !== undefined && decision.units !== line.units) {
        changes.push(`units ${line.units} → ${decision.units}`);
      }
      if (decision.code && decision.code !== line.code) {
        changes.push(`code ${line.code} → ${decision.code}`);
      }
      newTrail.push(
        trailEntry(
          "Human review",
          "nutrient",
          "live",
          changes.length > 0
            ? `Corrected ${line.code}: ${changes.join(", ")}`
            : `Reviewed ${line.code} with no change`,
          reviewer,
        ),
      );
      return {
        ...line,
        code: decision.code ?? line.code,
        description: decision.description ?? line.description,
        units: decision.units ?? line.units,
        charged: decision.charged ?? line.charged,
        confidence: 1,
        needsReview: false,
        reviewedBy: reviewer,
        reviewedAt: at,
      };
    }

    newTrail.push(
      trailEntry(
        "Human review",
        "nutrient",
        "live",
        `Confirmed ${line.code} "${line.description}" at $${line.charged.toLocaleString()} ` +
          `(extracted with ${(line.confidence * 100).toFixed(0)}% confidence)`,
        reviewer,
      ),
    );
    return {
      ...line,
      confidence: 1,
      needsReview: false,
      reviewedBy: reviewer,
      reviewedAt: at,
    };
  });

  const kept = lines.filter((l) => !removed.has(l.id));
  const billedTotal = Number(kept.reduce((s, l) => s + l.charged, 0).toFixed(2));

  const updated = await updateCase(id, {
    lines: kept,
    billedTotal,
    status: "auditing",
    trail: newTrail,
  });

  return NextResponse.json({
    case: updated,
    reviewedCount: decisions.length,
    removedCount: removed.size,
  });
}
