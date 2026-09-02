import { NextResponse } from "next/server";

import { isDisabled, vendorConfigured, vendorStatuses } from "@/lib/config";
import { VENDOR_LABEL, VENDOR_ROLE, type Vendor } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Vendor status for the UI rail and the judges page.
 *
 * `mode` is what actually matters on stage: "live" means the next call really
 * hits that vendor; "fallback" means BillShield will do the work itself and
 * say so.
 */
export async function GET() {
  const statuses = vendorStatuses().map((s) => {
    const disabled = isDisabled(s.vendor);
    const configured = vendorConfigured(s.vendor);
    return {
      vendor: s.vendor,
      label: VENDOR_LABEL[s.vendor as Vendor],
      role: VENDOR_ROLE[s.vendor as Vendor],
      configured,
      disabled,
      mode: configured && !disabled ? "live" : "fallback",
      reason: disabled
        ? "switched off for this run"
        : configured
          ? "credentials present"
          : `set ${s.envVars.join(" and ")}`,
      envVars: s.envVars,
    };
  });

  return NextResponse.json({
    ok: true,
    // The demo is always runnable; that is the point of the fallbacks.
    ready: true,
    liveCount: statuses.filter((s) => s.mode === "live").length,
    vendors: statuses,
  });
}
