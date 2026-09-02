import { NextResponse } from "next/server";

import { getCase } from "@/lib/adapters/xano";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const record = await getCase(id);
  if (!record) {
    return NextResponse.json({ error: `case ${id} not found` }, { status: 404 });
  }
  return NextResponse.json({ case: record });
}
