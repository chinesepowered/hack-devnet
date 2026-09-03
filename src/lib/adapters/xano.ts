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
 * ---------------------------------------------------------------------------
 * SHAPED FOR XANO'S AUTO-GENERATED CRUD
 * ---------------------------------------------------------------------------
 * Xano gives every table an integer primary key and can generate the five CRUD
 * endpoints for it in one click. Our case ids are strings (`case_8f21ac03`), so
 * rather than make someone hand-build endpoints keyed on a text column, we let
 * Xano own the integer key and carry our own id in a `ref` column. The row id
 * that comes back from the create call is remembered locally and used for the
 * later PATCH.
 *
 * The queryable columns are denormalized for the dashboard; `data` holds the
 * whole record so nothing is lost. Generated PDFs are stripped before sending:
 * they are megabytes of base64, they do not round-trip reliably, and the demo
 * only ever serves them from this process.
 *
 * Table `case`:
 *   ref             text
 *   status          text
 *   patient         text
 *   provider        text
 *   billed_total    decimal
 *   disputed_total  decimal
 *   finding_count   int
 *   signed          bool
 *   data            json
 */

const MAX_LOCAL_CASES = 50;

/**
 * Survives Next.js dev-mode module reloads, which would otherwise wipe the
 * store between requests and make the dashboard look broken.
 */
const globalStore = globalThis as unknown as {
  __billshieldCases?: Map<string, CaseRecord>;
  __billshieldRemoteIds?: Map<string, number>;
};
const localCases: Map<string, CaseRecord> =
  globalStore.__billshieldCases ?? (globalStore.__billshieldCases = new Map());
/** Our case id → the integer row id Xano assigned it. */
const remoteIds: Map<string, number> =
  globalStore.__billshieldRemoteIds ?? (globalStore.__billshieldRemoteIds = new Map());

interface CaseRow {
  id?: number;
  ref?: string;
  status?: string;
  patient?: string;
  provider?: string;
  billed_total?: number;
  disputed_total?: number;
  finding_count?: number;
  signed?: boolean;
  data?: CaseRecord | string;
}

function xanoUrl(path: string): string {
  return `${XANO_BASE_URL().replace(/\/$/, "")}${path}`;
}

function xanoHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = XANO_TOKEN();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** The row we send to Xano: queryable columns plus the record, minus the blob. */
function toRow(record: CaseRecord): CaseRow {
  const data: CaseRecord = record.document
    ? { ...record, document: { ...record.document, pdfBase64: "" } }
    : record;

  return {
    ref: record.id,
    status: record.status,
    patient: record.meta.patientName,
    provider: record.meta.provider,
    billed_total: record.billedTotal,
    disputed_total: record.disputedTotal,
    finding_count: record.findings.length,
    signed: record.signature?.status === "signed",
    data,
  };
}

/** Rebuild a record from a row, tolerating `data` arriving as a JSON string. */
function fromRow(row: CaseRow): CaseRecord | undefined {
  if (!row?.data) return undefined;
  try {
    const parsed = typeof row.data === "string" ? (JSON.parse(row.data) as CaseRecord) : row.data;
    return parsed?.id ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function trimLocalStore(): void {
  if (localCases.size <= MAX_LOCAL_CASES) return;
  const oldest = [...localCases.values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, localCases.size - MAX_LOCAL_CASES);
  for (const c of oldest) {
    localCases.delete(c.id);
    remoteIds.delete(c.id);
  }
}

export async function saveCase(record: CaseRecord): Promise<AdapterResult<CaseRecord>> {
  const elapsed = stopwatch();
  localCases.set(record.id, record);
  trimLocalStore();

  if (!vendorLive("xano")) {
    return {
      data: record,
      vendor: "xano",
      provenance: "fallback",
      note: `no Xano instance configured — case ${record.id} held in the local store`,
      ms: elapsed(),
    };
  }

  try {
    const saved = await vendorJson<CaseRow>(xanoUrl("/case"), {
      method: "POST",
      headers: xanoHeaders(),
      body: JSON.stringify(toRow(record)),
    });
    if (typeof saved?.id === "number") remoteIds.set(record.id, saved.id);

    return {
      data: record,
      vendor: "xano",
      provenance: "live",
      note:
        `Case ${record.id} persisted to Xano as row ${saved?.id ?? "?"} ` +
        `with ${record.trail.length} audit entries`,
      ms: elapsed(),
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      data: record,
      vendor: "xano",
      provenance: "fallback",
      note: `Xano unavailable (${reason}) — case held in the local store`,
      ms: elapsed(),
    };
  }
}

export async function getCase(id: string): Promise<CaseRecord | undefined> {
  const local = localCases.get(id);
  // The local mirror is authoritative for this process: it is the only place
  // the generated PDF bytes exist, and every stage writes through it.
  if (local) return local;

  if (vendorLive("xano")) {
    try {
      const rows = await vendorJson<CaseRow[]>(xanoUrl("/case"), { headers: xanoHeaders() });
      const row = Array.isArray(rows) ? rows.find((r) => r.ref === id) : undefined;
      const record = row ? fromRow(row) : undefined;
      if (record) {
        if (typeof row?.id === "number") remoteIds.set(id, row.id);
        return record;
      }
    } catch {
      // Nothing else to try.
    }
  }
  return undefined;
}

export async function listCases(): Promise<{
  cases: CaseRecord[];
  provenance: "live" | "fallback";
}> {
  if (vendorLive("xano")) {
    try {
      const rows = await vendorJson<CaseRow[]>(xanoUrl("/case"), { headers: xanoHeaders() });
      if (Array.isArray(rows)) {
        const cases = rows
          .map(fromRow)
          .filter((c): c is CaseRecord => Boolean(c))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        if (cases.length > 0) return { cases, provenance: "live" };
      }
    } catch {
      // Fall through to the mirror.
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
  localCases.set(id, merged);

  const rowId = remoteIds.get(id);
  if (vendorLive("xano") && rowId !== undefined) {
    try {
      // Xano's generated edit endpoint takes the integer row id in the path.
      await vendorJson(xanoUrl(`/case/${rowId}`), {
        method: "PATCH",
        headers: xanoHeaders(),
        body: JSON.stringify(toRow(merged)),
      });
    } catch {
      // The local mirror above already reflects the change.
    }
  }

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
    const source = e.vendor === "system" ? "system" : `${e.vendor}/${e.provenance}`;
    return `${String(i + 1).padStart(2, "0")}.  ${when}   ${e.stage}  (${source})  ${e.detail}${who}`;
  });
}
