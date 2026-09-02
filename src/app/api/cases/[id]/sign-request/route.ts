import { NextResponse } from "next/server";

import { requestSignature } from "@/lib/adapters/foxit";
import { getCase, trailEntry, updateCase } from "@/lib/adapters/xano";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Stage 6: prepare the letter for signature.
 *
 * This is the last thing the agent does on its own. It ends with a document
 * addressed to a named human and a status of `awaiting_signature` — never
 * `signed`. Producing a signature requires the separate, human-gated route.
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
  if (!record.document) {
    return NextResponse.json(
      { error: "generate the letter before requesting a signature" },
      { status: 409 },
    );
  }
  // The document blob lives in this process, not in the records backend. If it
  // is gone — a restart, another instance, an evicted mirror — refuse rather
  // than mint an envelope and hash zero bytes.
  if (!record.document.pdfBase64) {
    return NextResponse.json(
      {
        error:
          "the generated document is no longer available on this server — regenerate the letter before requesting a signature",
      },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    signerEmail?: string;
  };

  const signature = await requestSignature({
    documentId: record.document.documentId,
    title: record.document.title,
    pdfBase64: record.document.pdfBase64,
    signerName: record.meta.patientName,
    signerEmail: body.signerEmail?.trim() || "patient@example.com",
  });

  const trail = [
    ...record.trail,
    trailEntry(
      "Signature requested",
      signature.vendor,
      signature.provenance,
      `${signature.note}. Document SHA-256 ${signature.data.documentHash.slice(0, 16)}… recorded before presentation. ` +
        `The agent stops here: applying the signature requires a human.`,
    ),
  ];

  const updated = await updateCase(id, {
    signature: signature.data,
    status: "awaiting_signature",
    trail,
  });

  return NextResponse.json({
    case: updated ? { ...updated, document: { ...record.document, pdfBase64: "" } } : updated,
    signature: signature.data,
    stage: {
      name: "sign-request",
      vendor: signature.vendor,
      provenance: signature.provenance,
      note: signature.note,
      ms: signature.ms,
    },
  });
}
