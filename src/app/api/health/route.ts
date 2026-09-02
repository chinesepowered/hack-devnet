import { NextResponse } from "next/server";

import { LLM_MODEL, isDisabled, vendorConfigured, vendorStatuses } from "@/lib/config";
import { VENDOR_LABEL, VENDOR_ROLE, type Vendor } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Show the configured model id, trimmed of any org prefix, e.g. Qwen/Qwen3-8B. */
function modelLabel(): string {
  const model = LLM_MODEL();
  const short = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model;
  return short.length > 22 ? `${short.slice(0, 21)}…` : short;
}

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
      // The model is configurable, so name it rather than saying "LLM".
      label: s.vendor === "llm" ? modelLabel() : VENDOR_LABEL[s.vendor as Vendor],
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
