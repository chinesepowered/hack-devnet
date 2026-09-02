/**
 * Credential detection and the demo "chaos" switch.
 *
 * BillShield is built so that a missing or broken vendor never stops the demo.
 * Every adapter asks this module two questions: do I have credentials, and has
 * the operator deliberately disabled me for this run?
 */

import type { Vendor } from "./types";

export interface VendorConfig {
  vendor: Vendor;
  configured: boolean;
  /** Env var names this vendor reads, for the setup docs and the doctor script. */
  envVars: string[];
}

function has(...names: string[]): boolean {
  return names.every((n) => {
    const v = process.env[n];
    return typeof v === "string" && v.trim().length > 0;
  });
}

// Nutrient ships two separate products with two separate keys. The Processor
// API (/build) and the Data Extraction API (/extraction/extract) are different
// tenants, so a key for one is not a key for the other.
export const NUTRIENT_API_KEY = () =>
  (process.env.NUTRIENT_DWS_API_KEY ?? process.env.NUTRIENT_API_KEY)?.trim() ?? "";
export const NUTRIENT_EXTRACTION_KEY = () =>
  process.env.NUTRIENT_DWS_EXTRACTION_API_KEY?.trim() ?? "";
export const NUTRIENT_BASE_URL = () =>
  (process.env.DWS_API_BASE_URL ?? process.env.NUTRIENT_BASE_URL)?.trim() ||
  "https://api.nutrient.io";

export const SERPAPI_KEY = () => process.env.SERPAPI_API_KEY?.trim() ?? "";

export const DOCTAVIAN_API_KEY = () => process.env.DOCTAVIAN_API_KEY?.trim() ?? "";
export const DOCTAVIAN_BEARER = () => process.env.DOCTAVIAN_BEARER_TOKEN?.trim() ?? "";
export const DOCTAVIAN_BASE_URL = () =>
  process.env.DOCTAVIAN_BASE_URL?.trim() || "https://api.doctavian.com";
/** GUID of a template already uploaded to the Doctavian workspace. */
export const DOCTAVIAN_TEMPLATE_URN = () =>
  process.env.DOCTAVIAN_TEMPLATE_URN?.trim() ?? "";

// Foxit exposes PDF Services, Document Generation and eSign behind one gateway,
// authenticated with a client_id/client_secret header pair — no token exchange.
export const FOXIT_CLIENT_ID = () => process.env.FOXIT_CLIENT_ID?.trim() ?? "";
export const FOXIT_CLIENT_SECRET = () => process.env.FOXIT_CLIENT_SECRET?.trim() ?? "";
export const FOXIT_BASE_URL = () =>
  process.env.FOXIT_BASE_URL?.trim() || "https://na1.fusion.foxit.com";

export const XANO_BASE_URL = () => process.env.XANO_API_BASE_URL?.trim() ?? "";
export const XANO_TOKEN = () => process.env.XANO_AUTH_TOKEN?.trim() ?? "";

// Any OpenAI-compatible endpoint: vLLM, Ollama, Together, OpenRouter, LM
// Studio, or OpenAI itself. OPENAI_* are accepted as aliases because most
// compatible tooling already sets them.
export const LLM_BASE_URL = () =>
  (process.env.LLM_BASE_URL ?? process.env.OPENAI_BASE_URL)?.trim() ||
  "https://api.openai.com/v1";
export const LLM_API_KEY = () =>
  (process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY)?.trim() ?? "";
export const LLM_MODEL = () =>
  (process.env.LLM_MODEL ?? process.env.OPENAI_MODEL)?.trim() || "qwen3-8b";

/** Request timeout for every outbound vendor call. Keeps the demo moving. */
export const VENDOR_TIMEOUT_MS = Number(process.env.VENDOR_TIMEOUT_MS ?? 12_000);

/**
 * Comma-separated list of vendors to force into fallback mode, e.g.
 * `DISABLE_VENDORS=serpapi,foxit`. The judges page can also toggle this at
 * runtime, which is how we demonstrate resilience on stage without editing env.
 */
const runtimeDisabled = new Set<Vendor>();

export function setVendorDisabled(vendor: Vendor, disabled: boolean): void {
  if (disabled) runtimeDisabled.add(vendor);
  else runtimeDisabled.delete(vendor);
}

export function listDisabledVendors(): Vendor[] {
  return [...runtimeDisabled];
}

export function isDisabled(vendor: Vendor): boolean {
  if (runtimeDisabled.has(vendor)) return true;
  const env = process.env.DISABLE_VENDORS ?? "";
  return env
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .includes(vendor);
}

export function vendorConfigured(vendor: Vendor): boolean {
  switch (vendor) {
    case "nutrient":
      return has("NUTRIENT_DWS_API_KEY") || has("NUTRIENT_API_KEY");
    case "serpapi":
      return has("SERPAPI_API_KEY");
    case "doctavian":
      return has("DOCTAVIAN_API_KEY") || has("DOCTAVIAN_BEARER_TOKEN");
    case "foxit":
      // The gateway requires both halves; holding only one is a misconfiguration.
      return has("FOXIT_CLIENT_ID", "FOXIT_CLIENT_SECRET");
    case "xano":
      return has("XANO_API_BASE_URL");
    case "llm":
      // A local server needs no key, so a base URL alone is enough to try.
      return has("LLM_BASE_URL") || has("OPENAI_BASE_URL") || has("LLM_API_KEY") || has("OPENAI_API_KEY");
  }
}

/** A vendor is "live" only if it has credentials AND has not been switched off. */
export function vendorLive(vendor: Vendor): boolean {
  return vendorConfigured(vendor) && !isDisabled(vendor);
}

export function vendorStatuses(): VendorConfig[] {
  const map: Record<Vendor, string[]> = {
    nutrient: ["NUTRIENT_DWS_API_KEY"],
    llm: ["LLM_BASE_URL", "LLM_MODEL"],
    serpapi: ["SERPAPI_API_KEY"],
    doctavian: ["DOCTAVIAN_API_KEY"],
    foxit: ["FOXIT_CLIENT_ID", "FOXIT_CLIENT_SECRET"],
    xano: ["XANO_API_BASE_URL"],
  };
  return (Object.keys(map) as Vendor[]).map((vendor) => ({
    vendor,
    configured: vendorConfigured(vendor),
    envVars: map[vendor],
  }));
}
