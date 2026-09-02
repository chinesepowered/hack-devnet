import { NextResponse } from "next/server";

import { listDisabledVendors, setVendorDisabled } from "@/lib/config";
import type { Vendor } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID: Vendor[] = ["nutrient", "anthropic", "serpapi", "doctavian", "foxit", "xano"];

/**
 * The chaos switch.
 *
 * Lets the operator kill any vendor mid-demo and re-run the pipeline to show
 * the fallback taking over. This is a demo affordance, so it is deliberately
 * process-local and resets when the server restarts.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    vendor?: string;
    disabled?: boolean;
  };

  const vendor = body.vendor as Vendor | undefined;
  if (!vendor || !VALID.includes(vendor)) {
    return NextResponse.json(
      { error: `vendor must be one of: ${VALID.join(", ")}` },
      { status: 400 },
    );
  }

  setVendorDisabled(vendor, Boolean(body.disabled));
  return NextResponse.json({ ok: true, disabled: listDisabledVendors() });
}

export async function GET() {
  return NextResponse.json({ disabled: listDisabledVendors() });
}
