import type { CaseRecord, Provenance, Vendor } from "./types";

/** Client-side API wrappers. Every call surfaces the stage's provenance. */

export interface StageInfo {
  name: string;
  vendor: Vendor;
  provenance: Provenance;
  note: string;
  ms: number;
}

export interface VendorStatus {
  vendor: Vendor;
  label: string;
  role: string;
  configured: boolean;
  disabled: boolean;
  mode: "live" | "fallback";
  reason: string;
  envVars: string[];
}

export interface SampleSummary {
  id: string;
  label: string;
  blurb: string;
  glyph: string;
  provider: string;
  total: number;
  lineCount: number;
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((json as { error?: string }).error ?? `request failed (${res.status})`);
  }
  return json as T;
}

export const api = {
  health: () => fetch("/api/health").then((r) => r.json()) as Promise<{ vendors: VendorStatus[]; liveCount: number }>,

  samples: () => fetch("/api/samples").then((r) => r.json()) as Promise<{ samples: SampleSummary[] }>,

  setVendor: (vendor: Vendor, disabled: boolean) =>
    post<{ disabled: Vendor[] }>("/api/vendors", { vendor, disabled }),

  open: (input: { sampleId?: string; pdfBase64?: string; filename?: string }) =>
    post<{ case: CaseRecord; stage: StageInfo; needsReview: string[]; documentConfidence: number }>(
      "/api/cases",
      input,
    ),

  review: (
    id: string,
    reviewer: string,
    decisions: Array<{
      lineId: string;
      action: "confirm" | "correct" | "remove";
      charged?: number;
      units?: number;
    }>,
  ) => post<{ case: CaseRecord }>(`/api/cases/${id}/review`, { reviewer, decisions }),

  audit: (id: string) =>
    post<{ case: CaseRecord; summary: string; stage: StageInfo }>(`/api/cases/${id}/audit`),

  benchmark: (id: string) =>
    post<{ case: CaseRecord; stage: StageInfo }>(`/api/cases/${id}/benchmark`),

  generate: (id: string) =>
    post<{ case: CaseRecord; stage: StageInfo }>(`/api/cases/${id}/generate`),

  signRequest: (id: string, signerEmail: string) =>
    post<{ case: CaseRecord; stage: StageInfo }>(`/api/cases/${id}/sign-request`, { signerEmail }),

  signApply: (id: string, typedSignature: string) =>
    post<{ case: CaseRecord; stage: StageInfo }>(`/api/cases/${id}/sign-apply`, {
      typedSignature,
      confirmed: true,
    }),

  /** Deliberately omits `confirmed`, to prove the boundary refuses the agent. */
  signApplyAsAgent: (id: string) =>
    post<unknown>(`/api/cases/${id}/sign-apply`, { typedSignature: "Autonomous Agent" }),

  cases: () =>
    fetch("/api/cases").then((r) => r.json()) as Promise<{
      provenance: string;
      cases: Array<{
        id: string;
        createdAt: string;
        status: string;
        patient: string;
        provider: string;
        billedTotal: number;
        disputedTotal: number;
        findingCount: number;
        signed: boolean;
      }>;
    }>,
};

/** Read a File as base64, stripping the data-URL prefix. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("could not read that file"));
    reader.readAsDataURL(file);
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
