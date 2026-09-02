import {
  DOCTAVIAN_API_KEY,
  DOCTAVIAN_BASE_URL,
  DOCTAVIAN_BEARER,
  DOCTAVIAN_TEMPLATE_URN,
  vendorLive,
} from "../config";
import { stopwatch, vendorFetch, VendorError } from "../http";
import { buildLetterPayload, renderLetter, type LetterContext } from "../letter-template";
import { renderLetterPdf, toBase64 } from "../pdf";
import type { AdapterResult, GeneratedDocument } from "../types";

/**
 * Doctavian — document generation.
 *
 * The dispute letter is not a form letter. It branches on whether the patient
 * is insured, on whether a human reviewed any extracted field, and on whether
 * the disputed share crosses the threshold that justifies a regulatory
 * escalation paragraph; it loops over every finding and every line item inside
 * each finding; and it calculates its own subtotals and corrected balance.
 *
 * That structured payload is what Doctavian's template consumes. The local
 * renderer in letter-template.ts implements the same template semantics, so a
 * Doctavian outage costs the demo nothing but the vendor badge.
 *
 * The live flow is three calls, per Doctavian's API: upload the data document,
 * generate against a template already in the workspace, then download the
 * result. `DOCTAVIAN_TEMPLATE_URN` names that template.
 */

/** Every Doctavian response is wrapped in this envelope. */
interface DoctavianEnvelope<T> {
  result?: { data?: T; statusCode?: number | string; message?: string };
  error?: {
    statusCode?: number | string;
    message?: string;
    innerErrors?: Array<{ message?: string; userMessage?: string }>;
  };
}

interface UploadData {
  files?: Array<{ id?: string; fileName?: string }>;
}

interface GenerateData {
  document?: { urn?: string; name?: string; fileFormat?: string };
}

function doctavianHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Storage-Type": "document-data",
    ...extra,
  };
  const key = DOCTAVIAN_API_KEY();
  if (key) headers["X-Api-Key"] = key;
  const bearer = DOCTAVIAN_BEARER();
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return headers;
}

function unwrap<T>(env: DoctavianEnvelope<T>, what: string): T {
  if (env.error) {
    const inner = env.error.innerErrors?.[0];
    throw new VendorError(
      `${what}: ${env.error.message ?? "unknown error"}${inner?.message ? ` (${inner.message})` : ""}`,
    );
  }
  if (!env.result?.data) throw new VendorError(`${what}: response contained no data`);
  return env.result.data;
}

async function doctavianJson<T>(
  path: string,
  init: RequestInit,
  what: string,
): Promise<T> {
  const res = await vendorFetch(`${DOCTAVIAN_BASE_URL().replace(/\/$/, "")}${path}`, init);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new VendorError(`${what}: HTTP ${res.status} ${detail.slice(0, 200)}`, res.status);
  }
  return unwrap<T>((await res.json()) as DoctavianEnvelope<T>, what);
}

export async function generateDisputeLetter(
  ctx: LetterContext,
): Promise<AdapterResult<GeneratedDocument>> {
  const elapsed = stopwatch();
  // Rendered locally regardless: we need the preview text and the branch list
  // for the UI, and it is the body we fall back to.
  const local = renderLetter(ctx);
  const payload = buildLetterPayload(ctx);
  const documentId = `doc_${Date.now().toString(36)}`;

  if (!vendorLive("doctavian")) {
    return localDocument(
      local,
      documentId,
      elapsed,
      "no Doctavian credentials configured — rendered locally with the same template logic",
    );
  }

  if (!DOCTAVIAN_TEMPLATE_URN()) {
    return localDocument(
      local,
      documentId,
      elapsed,
      "no DOCTAVIAN_TEMPLATE_URN set (upload the .docx template and set its GUID) — rendered locally",
    );
  }

  try {
    // 1. Upload the structured data the template will bind to.
    const uploaded = await doctavianJson<UploadData>(
      "/v1/documents/data/upload",
      {
        method: "POST",
        headers: doctavianHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      },
      "data upload",
    );

    const dataUrn = uploaded.files?.[0]?.id;
    if (!dataUrn) throw new VendorError("data upload returned no file id");

    // 2. Generate the document from the template plus that data.
    const generated = await doctavianJson<GenerateData>(
      "/v1/documents/document/generate",
      {
        method: "POST",
        headers: doctavianHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          externalContext: { id: `billshield-${documentId}` },
          template: {
            name: "BillShield dispute letter",
            urn: DOCTAVIAN_TEMPLATE_URN(),
            fileFormat: "docx",
            loadMethod: "Storage",
          },
          data: { loadMethod: "Storage", urn: dataUrn },
          document: {
            timezone: "(GMT-08:00) Pacific Time (US & Canada)",
            locale: "en_US",
            name: local.title,
            fileFormat: "pdf",
            deliveryMethod: "Storage",
            path: "root",
          },
        }),
      },
      "document generation",
    );

    const docUrn = generated.document?.urn;
    if (!docUrn) throw new VendorError("generation returned no document urn");

    // 3. Download the rendered PDF.
    const dl = await vendorFetch(
      `${DOCTAVIAN_BASE_URL().replace(/\/$/, "")}/v1/documents/document/${encodeURIComponent(docUrn)}/download`,
      { headers: doctavianHeaders() },
    );
    if (!dl.ok) throw new VendorError(`document download failed: HTTP ${dl.status}`, dl.status);

    const buf = Buffer.from(await dl.arrayBuffer());
    if (!buf.subarray(0, 4).toString("latin1").startsWith("%PDF")) {
      throw new VendorError("downloaded document is not a PDF");
    }

    return {
      data: {
        documentId: docUrn,
        title: local.title,
        bodyText: local.body,
        pdfBase64: buf.toString("base64"),
        pageCount: Math.max(1, Math.ceil(local.body.length / 2400)),
        branchesTaken: local.branchesTaken,
      },
      vendor: "doctavian",
      provenance: "live",
      note:
        `Generated from template ${DOCTAVIAN_TEMPLATE_URN().slice(0, 8)}… bound to ` +
        `${payload.findings.length} findings; ${local.branchesTaken.length} template branches evaluated`,
      ms: elapsed(),
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return localDocument(
      local,
      documentId,
      elapsed,
      `Doctavian unavailable (${reason}) — rendered locally`,
    );
  }
}

async function localDocument(
  local: ReturnType<typeof renderLetter>,
  documentId: string,
  elapsed: () => number,
  note: string,
): Promise<AdapterResult<GeneratedDocument>> {
  const bytes = await renderLetterPdf(local.title, local.body);
  return {
    data: {
      documentId,
      title: local.title,
      bodyText: local.body,
      pdfBase64: toBase64(bytes),
      pageCount: Math.max(1, Math.ceil(local.body.length / 2400)),
      branchesTaken: local.branchesTaken,
    },
    vendor: "doctavian",
    provenance: "fallback",
    note: `${note} (${local.branchesTaken.length} branches evaluated)`,
    ms: elapsed(),
  };
}
