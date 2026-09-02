import { getCase } from "@/lib/adapters/xano";

export const dynamic = "force-dynamic";

/** Serve the current PDF for a case — draft before signature, signed after. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const record = await getCase(id);

  if (!record?.document?.pdfBase64) {
    return new Response("No document generated for this case yet.", { status: 404 });
  }

  const bytes = Buffer.from(record.document.pdfBase64, "base64");
  const signed = record.signature?.status === "signed";
  const disposition = new URL(request.url).searchParams.get("download") === "1"
    ? "attachment"
    : "inline";
  const filename = `${signed ? "signed-" : ""}dispute-letter-${record.meta.accountNumber}.pdf`;

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "no-store",
    },
  });
}
