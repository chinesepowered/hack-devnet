import { NextResponse } from "next/server";

import { applySignature, SigningBoundaryError } from "@/lib/adapters/foxit";
import { formatTrail, getCase, trailEntry, updateCase } from "@/lib/adapters/xano";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Stage 7: apply the signature. Human only.
 *
 * This route is the other side of the signing boundary. It exists so that a
 * person — not the agent — completes the one irreversible act in the workflow.
 * It refuses unless the request carries an explicit human confirmation, a
 * matching intent from the preparation step, and a document whose hash still
 * matches what was presented.
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
  if (!record.document || !record.signature) {
    return NextResponse.json(
      { error: "request a signature before applying one" },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    typedSignature?: string;
    confirmed?: boolean;
  };

  const typed = body.typedSignature?.trim();
  if (!typed) {
    return NextResponse.json(
      { error: "a signature is required" },
      { status: 400 },
    );
  }

  try {
    const signed = await applySignature({
      envelopeId: record.signature.envelopeId,
      pdfBase64: record.document.pdfBase64,
      signerName: record.meta.patientName,
      typedSignature: typed,
      auditLines: formatTrail(record.trail),
      // Set from the request body, which only the signing page sends.
      humanConfirmed: body.confirmed === true,
    });

    const trail = [
      ...record.trail,
      trailEntry(
        "Document signed",
        signed.vendor,
        signed.provenance,
        signed.note,
        record.meta.patientName,
      ),
    ];

    const updated = await updateCase(id, {
      document: { ...record.document, pdfBase64: signed.data.signedPdfBase64 },
      signature: { ...record.signature, ...signed.data.signature },
      status: "signed",
      trail,
    });

    return NextResponse.json({
      case: updated
        ? { ...updated, document: { ...updated.document!, pdfBase64: "" } }
        : updated,
      signature: signed.data.signature,
      stage: {
        name: "sign-apply",
        vendor: signed.vendor,
        provenance: signed.provenance,
        note: signed.note,
        ms: signed.ms,
      },
    });
  } catch (err) {
    if (err instanceof SigningBoundaryError) {
      // 403, not 500: the request was understood and deliberately refused.
      return NextResponse.json({ error: err.message, boundary: true }, { status: 403 });
    }
    throw err;
  }
}
