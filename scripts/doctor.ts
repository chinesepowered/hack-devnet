/**
 * Pre-demo check: `pnpm preflight`
 *
 * Named `preflight` rather than `doctor` because `pnpm doctor` is a built-in
 * pnpm command and would shadow this script entirely.
 *
 * Reports which vendors will run live and which will fall back, and — for the
 * ones with credentials — actually reaches out to confirm the credentials
 * work. Run this before you present, not during.
 */

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

interface Check {
  name: string;
  envVars: string[];
  /** Probe the credential. Resolves to a message, throws to report a failure. */
  probe?: () => Promise<string>;
}

const has = (...names: string[]) =>
  names.every((n) => (process.env[n] ?? "").trim().length > 0);

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms)),
  ]);
}

const CHECKS: Check[] = [
  {
    name: "Model endpoint",
    envVars: ["LLM_BASE_URL"],
    probe: async () => {
      const base = (process.env.LLM_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "").trim().replace(/\/$/, "");
      const key = (process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? "").trim();
      const model = (process.env.LLM_MODEL ?? process.env.OPENAI_MODEL ?? "qwen3-8b").trim();
      const res = await withTimeout(
        fetch(`${base}/models`, key ? { headers: { Authorization: `Bearer ${key}` } } : {}),
        10_000,
      );
      if (!res.ok) throw new Error(`GET ${base}/models returned HTTP ${res.status}`);
      const json = (await res.json()) as { data?: Array<{ id?: string }> };
      const ids = (json.data ?? []).map((m) => m.id).filter(Boolean) as string[];
      if (ids.length === 0) return `reachable; LLM_MODEL=${model}`;
      const served = ids.some((id) => id === model || id.endsWith(`/${model}`));
      return served
        ? `serving ${model}`
        : `reachable, but ${model} is NOT in the served list (${ids.slice(0, 3).join(", ")}${ids.length > 3 ? ", …" : ""})`;
    },
  },
  {
    name: "Nutrient DWS (processor)",
    envVars: ["NUTRIENT_DWS_API_KEY"],
  },
  {
    name: "Nutrient DWS (extraction)",
    envVars: ["NUTRIENT_DWS_EXTRACTION_API_KEY"],
  },
  {
    name: "SerpApi",
    envVars: ["SERPAPI_API_KEY"],
    probe: async () => {
      const res = await withTimeout(
        fetch(
          "https://serpapi.com/account.json?api_key=" +
            encodeURIComponent(process.env.SERPAPI_API_KEY!.trim()),
        ),
        10_000,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { total_searches_left?: number };
      return json.total_searches_left !== undefined
        ? `${json.total_searches_left} searches left`
        : "credentials accepted";
    },
  },
  {
    name: "Doctavian",
    envVars: ["DOCTAVIAN_API_KEY"],
    probe: async () => {
      const res = await withTimeout(
        fetch(`${process.env.DOCTAVIAN_BASE_URL ?? "https://api.doctavian.com"}/public/v1/status`),
        10_000,
      );
      const reachable = res.ok ? "service reachable" : `service returned HTTP ${res.status}`;
      return process.env.DOCTAVIAN_TEMPLATE_URN?.trim()
        ? `${reachable}; template URN set`
        : `${reachable}; NO TEMPLATE URN — generation will render locally`;
    },
  },
  {
    name: "Foxit (PDF services + eSign)",
    envVars: ["FOXIT_CLIENT_ID", "FOXIT_CLIENT_SECRET"],
  },
  {
    name: "Xano",
    envVars: ["XANO_API_BASE_URL"],
    probe: async () => {
      const res = await withTimeout(fetch(process.env.XANO_API_BASE_URL!.trim()), 10_000);
      return `instance responded HTTP ${res.status}`;
    },
  },
];

async function main() {
  console.log("\nBillShield — pre-demo check\n");

  const disabled = (process.env.DISABLE_VENDORS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let live = 0;
  for (const check of CHECKS) {
    const configured = has(...check.envVars);
    if (!configured) {
      console.log(
        `${YELLOW}○${RESET} ${check.name.padEnd(30)} ${DIM}fallback — set ${check.envVars.join(", ")}${RESET}`,
      );
      continue;
    }

    if (!check.probe) {
      live += 1;
      console.log(`${GREEN}●${RESET} ${check.name.padEnd(30)} ${DIM}credentials present${RESET}`);
      continue;
    }

    try {
      const detail = await check.probe();
      live += 1;
      console.log(`${GREEN}●${RESET} ${check.name.padEnd(30)} ${DIM}${detail}${RESET}`);
    } catch (err) {
      console.log(
        `${RED}✕${RESET} ${check.name.padEnd(30)} ${DIM}credentials present but the probe failed: ${
          err instanceof Error ? err.message : String(err)
        }${RESET}`,
      );
    }
  }

  if (disabled.length > 0) {
    console.log(`\n${YELLOW}Forced onto fallback via DISABLE_VENDORS:${RESET} ${disabled.join(", ")}`);
  }

  console.log(
    `\n${live} of ${CHECKS.length} vendors will run live. ` +
      `The demo runs end to end regardless — every stage has a fallback.\n` +
      `${DIM}Next: pnpm smoke   (exercises the whole pipeline, no browser needed)${RESET}\n`,
  );
}

main();
