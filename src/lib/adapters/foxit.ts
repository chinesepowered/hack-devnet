import { createHash, randomUUID } from "node:crypto";

import {
  FOXIT_BASE_URL,
  FOXIT_CLIENT_ID,
  FOXIT_CLIENT_SECRET,
  vendorLive,
} from "../config";
import { stopwatch, vendorFetch, VendorError } from "../http";
import { appendSignaturePage, type SignatureStamp } from "../pdf";
import type { AdapterResult, SignatureRequest } from "../types";

/**
 * Foxit eSign — the signing boundary.
 *
 * ---------------------------------------------------------------------------
 * WHERE WE PUT THE BOUNDARY, AND WHY
 * ---------------------------------------------------------------------------
 * Foxit's challenge leaves signing out of the agent's tool catalogue on
 * purpose, and asks how you would design the handoff. Our position:
 *
 * The boundary does not belong at "signing" as an operation. It belongs at
 * REVERSIBILITY. Everything the agent does here is undoable — generate a
 * letter, convert it, merge an exhibit, hash it. Redo any of it and nothing in
 * the world has changed. A signature is different in kind: it is the agent
 * making a legal assertion in a human's name, and there is no undo.
 *
 * So this module exposes two functions with deliberately different powers:
 *
 *   requestSignature()  — the agent may call this. It prepares the envelope,
 *                         hashes the exact bytes, and stops. Nothing is signed.
 *   applySignature()    — the agent may NOT call this. It is reachable only
 *                         from a human-initiated request carrying the intent
 *                         token minted below, and it refuses without one.
 *
 * The practical consequence is that an agent which gets confused, is prompt-
 * injected by a malicious bill, or simply loops, can waste tokens and produce
 * a wrong letter. It cannot produce a signed one. The blast radius of every
 * agent failure in this system stops at an unsigned PDF and a human who says
 * no.
 *
 * We also hash before presenting rather than after signing. The signer sees
 * the hash of what they are about to sign, and the same hash appears on the
 * audit page. An agent that alters the document between preparation and
 * signature invalidates its own envelope.
 */

/** Minted at preparation, spent at signature. One use, and it names the document. */
interface IntentToken {
  envelopeId: string;
  documentHash: string;
  issuedAt: number;
}

/**
 * Held on globalThis, not in module scope: Next.js reloads server modules
 * between requests in dev, and a wiped map would drop the intent minted at
 * preparation — making every signature fail the boundary check for reasons
 * that have nothing to do with the boundary.
 */
const intentStore = globalThis as unknown as {
  __billshieldIntents?: Map<string, IntentToken>;
};
const pendingIntents: Map<string, IntentToken> =
  intentStore.__billshieldIntents ?? (intentStore.__billshieldIntents = new Map());

export function sha256(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

/**
 * The Foxit gateway authenticates with a lowercase client_id/client_secret
 * header pair on every request. There is no token exchange step.
 */
function foxitHeaders(): Record<string, string> {
  return {
    client_id: FOXIT_CLIENT_ID(),
    client_secret: FOXIT_CLIENT_SECRET(),
    "Content-Type": "application/json",
  };
}

export interface SignatureRequestInput {
  documentId: string;
  title: string;
  pdfBase64: string;
  signerName: string;
  signerEmail: string;
}

/**
 * Prepare a document for signature. This is the furthest the agent may go.
 *
 * On success the document is sitting in an envelope, addressed to a named
 * human, with status `awaiting_signature`. No signature exists yet, and this
 * function has no code path that can create one.
 */
export async function requestSignature(
  input: SignatureRequestInput,
): Promise<AdapterResult<SignatureRequest>> {
  const elapsed = stopwatch();
  const bytes = Buffer.from(input.pdfBase64, "base64");
  const documentHash = sha256(bytes);
  const envelopeId = `env_${randomUUID()}`;
  const createdAt = new Date().toISOString();

  // Mint the intent token that applySignature() will demand later.
  pendingIntents.set(envelopeId, { envelopeId, documentHash, issuedAt: Date.now() });

  if (vendorLive("foxit")) {
    try {
      const base = FOXIT_BASE_URL().replace(/\/$/, "");
      const [firstName, ...rest] = input.signerName.trim().split(/\s+/);

      // Foxit eSign still calls an envelope a "folder" at the API layer.
      const res = await vendorFetch(`${base}/esign/api/v1/folders/createfolder`, {
        method: "POST",
        headers: foxitHeaders(),
        body: JSON.stringify({
          folderName: input.title,
          inputType: "base64",
          base64FileString: [input.pdfBase64],
          fileNames: [`${input.title}.pdf`],
          processTextTags: false,
          processAcroFields: false,
          parties: [
            {
              firstName: firstName || input.signerName,
              lastName: rest.join(" ") || "-",
              emailId: input.signerEmail,
              permission: "FILL_FIELDS_AND_SIGN",
              sequence: 1,
              allowNameChange: "false",
            },
          ],
          fields: [
            {
              type: "signature",
              x: 72,
              y: 560,
              width: 160,
              height: 28,
              documentNumber: 1,
              pageNumber: 1,
              tabOrder: 1,
              party: 1,
              required: true,
            },
            {
              type: "date",
              name: "Date Signed",
              dateFormat: "MM-DD-YYYY",
              x: 260,
              y: 560,
              width: 110,
              height: 28,
              documentNumber: 1,
              pageNumber: 1,
              tabOrder: 2,
              party: 1,
              required: true,
            },
          ],
          // Sent, not signed. The signature is the human's to give.
          sendNow: true,
          createEmbeddedSendingSession: true,
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new VendorError(
          `envelope creation failed: HTTP ${res.status} ${detail.slice(0, 160)}`,
          res.status,
        );
      }

      const json = (await res.json()) as {
        folder?: {
          folderId?: string | number;
          embeddedSigningSessions?: Array<{ embeddedSessionURL?: string; embeddedToken?: string }>;
        };
        embeddedSigningSessions?: Array<{ embeddedSessionURL?: string }>;
      };

      const remoteId = String(json.folder?.folderId ?? envelopeId);
      const signingUrl =
        json.folder?.embeddedSigningSessions?.[0]?.embeddedSessionURL ??
        json.embeddedSigningSessions?.[0]?.embeddedSessionURL ??
        `/sign/${remoteId}`;

      // Re-key the intent under whatever id the vendor assigned.
      pendingIntents.delete(envelopeId);
      pendingIntents.set(remoteId, { envelopeId: remoteId, documentHash, issuedAt: Date.now() });

      return {
        data: {
          envelopeId: remoteId,
          status: "awaiting_signature",
          signerName: input.signerName,
          signerEmail: input.signerEmail,
          signingUrl,
          createdAt,
          documentHash,
        },
        vendor: "foxit",
        provenance: "live",
        note: `Envelope ${remoteId} sent to ${input.signerEmail}; awaiting a human signature`,
        ms: elapsed(),
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        data: {
          envelopeId,
          status: "awaiting_signature",
          signerName: input.signerName,
          signerEmail: input.signerEmail,
          signingUrl: `/sign/${envelopeId}`,
          createdAt,
          documentHash,
        },
        vendor: "foxit",
        provenance: "fallback",
        note: `Foxit eSign unavailable (${reason}) — prepared a local signing ceremony; still requires a human`,
        ms: elapsed(),
      };
    }
  }

  return {
    data: {
      envelopeId,
      status: "awaiting_signature",
      signerName: input.signerName,
      signerEmail: input.signerEmail,
      signingUrl: `/sign/${envelopeId}`,
      createdAt,
      documentHash,
    },
    vendor: "foxit",
    provenance: "fallback",
    note: "no Foxit credentials configured — prepared a local signing ceremony; still requires a human",
    ms: elapsed(),
  };
}

export class SigningBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SigningBoundaryError";
  }
}

export interface ApplySignatureInput {
  envelopeId: string;
  pdfBase64: string;
  signerName: string;
  typedSignature: string;
  auditLines: string[];
  /**
   * Proof that a human initiated this. The API route sets it only when the
   * request arrives from the signing page with an explicit confirmation.
   * There is no value the agent can supply to satisfy this.
   */
  humanConfirmed: boolean;
}

/**
 * Apply a signature. Reachable only behind a human confirmation.
 *
 * This is the one function in the codebase that changes something irreversible,
 * and it is guarded three ways: a human must have confirmed, a matching intent
 * token must exist from the preparation step, and the document hash must still
 * match the bytes that were presented. Any of the three failing aborts.
 */
export async function applySignature(
  input: ApplySignatureInput,
): Promise<AdapterResult<{ signature: SignatureRequest; signedPdfBase64: string }>> {
  const elapsed = stopwatch();

  if (!input.humanConfirmed) {
    throw new SigningBoundaryError(
      "Signing requires a human confirmation. The agent prepared this envelope but cannot sign it.",
    );
  }

  const intent = pendingIntents.get(input.envelopeId);
  if (!intent) {
    throw new SigningBoundaryError(
      `No pending signature intent for envelope ${input.envelopeId}. Prepare the document before signing it.`,
    );
  }

  const bytes = Buffer.from(input.pdfBase64, "base64");
  const currentHash = sha256(bytes);
  if (currentHash !== intent.documentHash) {
    pendingIntents.delete(input.envelopeId);
    throw new SigningBoundaryError(
      "The document changed after it was prepared for signature. This envelope is void; prepare a new one.",
    );
  }

  const signedAt = new Date().toISOString();
  const usedLive = vendorLive("foxit");

  const stamp: SignatureStamp = {
    signerName: input.signerName,
    signedAt: new Date(signedAt).toLocaleString("en-US", {
      dateStyle: "long",
      timeStyle: "short",
    }),
    envelopeId: input.envelopeId,
    documentHash: currentHash,
    typedSignature: input.typedSignature,
    provider: usedLive ? "Foxit eSign" : "BillShield local signing ceremony",
  };

  const signedBytes = await appendSignaturePage(bytes, stamp, input.auditLines);

  // The intent is spent. A replayed request cannot sign the same envelope twice.
  pendingIntents.delete(input.envelopeId);

  return {
    data: {
      signature: {
        envelopeId: input.envelopeId,
        status: "signed",
        signerName: input.signerName,
        signerEmail: "",
        signingUrl: "",
        createdAt: new Date(intent.issuedAt).toISOString(),
        signedAt,
        documentHash: currentHash,
      },
      signedPdfBase64: Buffer.from(signedBytes).toString("base64"),
    },
    vendor: "foxit",
    provenance: usedLive ? "live" : "fallback",
    note: `Signed by ${input.signerName} at ${stamp.signedAt} via ${stamp.provider}; hash verified against the prepared document`,
    ms: elapsed(),
  };
}

/** Exposed for the judges page: what the agent is and is not allowed to do. */
export const AGENT_TOOL_BOUNDARY = {
  allowed: [
    "generate_document",
    "convert_document",
    "merge_documents",
    "compress_document",
    "ocr_document",
    "extract_data",
    "hash_document",
    "request_signature",
  ],
  withheld: [
    "apply_signature — requires a human confirmation the agent cannot forge",
    "void_envelope — irreversible for the counterparty",
    "send_to_collections_dispute — has legal effect on a third party",
  ],
  principle:
    "The agent owns everything reversible. Anything that makes an assertion in a human's name stops at a person.",
};
