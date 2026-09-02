import { XANO_BASE_URL, XANO_TOKEN, vendorLive } from "../config";
import { stopwatch, vendorJson } from "../http";
import type { AdapterResult, AuditTrailEntry, CaseRecord } from "../types";

/**
 * Xano — the backend of record.
 *
 * Cases, their line items, findings, and the full audit trail live here. The
 * fallback is an in-process store with identical semantics, so the dashboard
 * and the trail work on a laptop with no network at all.
 *
 * The in-memory store is deliberately capped: a demo machine left running for
 * two days should not accumulate unbounded state.
 */

const MAX_LOCAL_CASES = 50;

/**
 * Survives Next.js dev-mode module reloads, which would otherwise wipe the
 * store between requests and make the dashboard look broken.
 */
const globalStore = globalThis as unknown as {
  __billshieldCases?: Map<string, CaseRecord>;
};
const localCases: Map<string, CaseRecord> =
  globalStore.__billshieldCases ?? (globalStore.__billshieldCases = new Map());

function xanoUrl(path: string): string {
  return `${XANO_BASE_URL().replace(/\/$/, "")}${path}`;
}

function xanoHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = XANO_TOKEN();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function trimLocalStore(): void {
  if (localCases.size <= MAX_LOCAL_CASES) return;
  const oldest = [...localCases.values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, localCases.size - MAX_LOCAL_CASES);
  for (const c of oldest) localCases.delete(c.id);
}

export async function saveCase(record: CaseRecord): Promise<AdapterResult<CaseRecord>> {
  const elapsed = stopwatch();

  if (vendorLive("xano")) {
    try {
      const saved = await vendorJson<CaseRecord>(xanoUrl("/case"), {
        method: "POST",
        headers: xanoHeaders(),
        body: JSON.stringify(record),
      });
      // Mirror locally so a mid-demo Xano outage cannot orphan an open case.
      localCases.set(record.id, { ...record, ...saved, id: record.id });
      trimLocalStore();
      return {
        data: { ...record, ...saved, id: record.id },
        vendor: "xano",
        provenance: "live",
        note: `Case ${record.id} persisted to Xano with ${record.trail.length} audit entries`,
        ms: elapsed(),
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      localCases.set(record.id, record);
      trimLocalStore();
      return {
        data: record,
        vendor: "xano",
        provenance: "fallback",
        note: `Xano unavailable (${reason}) — case held in the local store`,
        ms: elapsed(),
      };
    }
  }

  localCases.set(record.id, record);
  trimLocalStore();
  return {
    data: record,
    vendor: "xano",
    provenance: "fallback",
    note: `no Xano instance configured — case ${record.id} held in the local store`,
    ms: elapsed(),
  };
}

export async function getCase(id: string): Promise<CaseRecord | undefined> {
  if (vendorLive("xano")) {
    try {
      const remote = await vendorJson<CaseRecord>(xanoUrl(`/case/${encodeURIComponent(id)}`), {
        headers: xanoHeaders(),
      });
      if (remote?.id) return remote;
    } catch {
      // Fall through to the local mirror.
    }
  }
  return localCases.get(id);
}

export async function listCases(): Promise<{ cases: CaseRecord[]; provenance: "live" | "fallback" }> {
  if (vendorLive("xano")) {
    try {
      const remote = await vendorJson<CaseRecord[]>(xanoUrl("/case"), {
        headers: xanoHeaders(),
      });
      if (Array.isArray(remote)) {
        return { cases: remote, provenance: "live" };
      }
    } catch {
      // Fall through.
    }
  }
  return {
    cases: [...localCases.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    provenance: "fallback",
  };
}

export async function updateCase(
  id: string,
  patch: Partial<CaseRecord>,
): Promise<CaseRecord | undefined> {
  const existing = await getCase(id);
  if (!existing) return undefined;
  const merged: CaseRecord = { ...existing, ...patch, id };

  if (vendorLive("xano")) {
    try {
      await vendorJson(xanoUrl(`/case/${encodeURIComponent(id)}`), {
        method: "PATCH",
        headers: xanoHeaders(),
        body: JSON.stringify(patch),
      });
    } catch {
      // Local mirror below still reflects the change.
    }
  }

  localCases.set(id, merged);
  return merged;
}

let trailSeq = 0;

export function trailEntry(
  stage: string,
  vendor: AuditTrailEntry["vendor"],
  provenance: AuditTrailEntry["provenance"],
  detail: string,
  actor?: string,
): AuditTrailEntry {
  trailSeq += 1;
  return {
    id: `t-${Date.now().toString(36)}-${trailSeq}`,
    at: new Date().toISOString(),
    stage,
    vendor,
    provenance,
    detail,
    actor,
  };
}

/** Render the trail for the PDF audit page. */
export function formatTrail(trail: AuditTrailEntry[]): string[] {
  return trail.map((e, i) => {
    const when = new Date(e.at).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "medium",
    });
    const who = e.actor ? `  [confirmed by ${e.actor}]` : "";
    const source =
      e.vendor === "system" ? "system" : `${e.vendor}/${e.provenance}`;
    return `${String(i + 1).padStart(2, "0")}.  ${when}   ${e.stage}  (${source})  ${e.detail}${who}`;
  });
}
