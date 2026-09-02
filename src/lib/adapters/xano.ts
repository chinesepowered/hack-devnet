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
        body: JSON.stringify(withoutBlob(record)),
      });
      // Mirror locally so a mid-demo Xano outage cannot orphan an open case.
      // `record` wins on the document, since Xano never receives the PDF bytes.
      const merged = { ...record, ...saved, id: record.id, document: record.document };
      localCases.set(record.id, merged);
      trimLocalStore();
      return {
        data: merged,
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

/**
 * Generated PDFs are megabytes of base64. Sending them to a records API is a
 * good way to hit a payload limit mid-demo, and they do not round-trip
 * reliably, so the document blob stays local and only its metadata is
 * persisted remotely.
 */
function withoutBlob(record: Partial<CaseRecord>): Partial<CaseRecord> {
  if (!record.document) return record;
  return { ...record, document: { ...record.document, pdfBase64: "" } };
}

export async function getCase(id: string): Promise<CaseRecord | undefined> {
  const local = localCases.get(id);

  if (vendorLive("xano")) {
    try {
      const remote = await vendorJson<CaseRecord>(xanoUrl(`/case/${encodeURIComponent(id)}`), {
        headers: xanoHeaders(),
      });
      if (remote?.id) {
        // Xano is the record of truth for everything except the PDF bytes,
        // which never left this process — merge rather than replace, or
        // signing and download break whenever Xano is configured. Prefer the
        // local mirror but keep whatever the remote holds when it is cold,
        // rather than erasing bytes a previous build did persist.
        const pdfBase64 =
          local?.document?.pdfBase64 || remote.document?.pdfBase64 || "";
        return remote.document
          ? { ...remote, document: { ...remote.document, pdfBase64 } }
          : { ...remote, document: local?.document };
      }
    } catch {
      // Fall through to the local mirror.
    }
  }
  return local;
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
        body: JSON.stringify(withoutBlob(patch)),
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
