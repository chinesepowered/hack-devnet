import { VENDOR_TIMEOUT_MS } from "./config";

export class VendorError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "VendorError";
  }
}

/**
 * fetch with a hard timeout. Every vendor call goes through this so a hanging
 * third party can never freeze a live demo — it fails fast and the caller
 * drops to its fallback.
 */
export async function vendorFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = VENDOR_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new VendorError(`request timed out after ${timeoutMs}ms`);
    }
    throw new VendorError(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

export async function vendorJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<T> {
  const res = await vendorFetch(url, init, timeoutMs);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new VendorError(
      `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
      res.status,
    );
  }
  return (await res.json()) as T;
}

/** Wall-clock timer for adapter results. */
export function stopwatch(): () => number {
  const start = Date.now();
  return () => Date.now() - start;
}
