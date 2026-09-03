"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/client";
import { Panel, ProvenanceChip } from "./primitives";
import { useVendorStatuses } from "./Rails";

/**
 * The judges page.
 *
 * Two jobs. First, state plainly what each sponsor API does here and how to
 * verify it — no vague "powered by" claims. Second, let anyone kill any vendor
 * and re-run the pipeline, which is the honest way to demonstrate that the
 * fallbacks are real rather than asserted.
 */

const WORK: Array<{
  vendor: string;
  did: string;
  verify: string;
  where: string;
}> = [
  {
    vendor: "nutrient",
    did: "Parses the uploaded PDF into typed line items with a confidence score per field, using the DWS Data Extraction API against a bill schema we define. Rows scoring below 0.90 are routed to a human before anything downstream can use them.",
    verify: "Watch the Extraction stage, then the Review gate that holds the pipeline until a person confirms.",
    where: "src/lib/adapters/nutrient.ts",
  },
  {
    vendor: "llm",
    did: "Reads the whole encounter and finds what a rules engine cannot: services that make no clinical sense together, and the paragraph that will actually persuade a billing manager. Any OpenAI-compatible endpoint — we run an open-weight Qwen3 model. Every finding it returns is validated against real line ids and clamped to what those lines were charged.",
    verify: "The audit stage note names the model, the structured-output mode the server accepted, and how many findings it added or rejected as unverifiable.",
    where: "src/lib/adapters/llm.ts",
  },
  {
    vendor: "serpapi",
    did: "Turns 'this seems expensive' into evidence, retrieving what other providers publish for the same procedure code today and embedding the comparison — with sources — into the letter itself.",
    verify: "Open any row in Price evidence to see the observed prices and their links.",
    where: "src/lib/adapters/serpapi.ts",
  },
  {
    vendor: "doctavian",
    did: "Renders the dispute letter from a template that branches, loops and calculates: insured vs self-pay headers, a verification paragraph only when a human reviewed something, a regulatory escalation clause only above 40% disputed, a records request only for low-confidence findings, and totals it computes itself.",
    verify: "The Draft panel lists every template branch that was evaluated for this particular bill.",
    where: "src/lib/letter-template.ts, src/lib/adapters/doctavian.ts",
  },
  {
    vendor: "foxit",
    did: "Carries the finished letter across the signing boundary. The agent may prepare an envelope and hash the document; it has no code path that can sign one. Signing requires a human confirmation, a matching intent token from the preparation step, and an unchanged document hash.",
    verify: "Press 'Let the agent try to sign it' on any prepared document. The API returns 403.",
    where: "src/lib/adapters/foxit.ts",
  },
  {
    vendor: "xano",
    did: "Backend of record for cases, line items, findings, and the audit trail that is printed into the signed PDF.",
    verify: "The Audit trail rail, and the same list on the last page of the downloaded PDF.",
    where: "src/lib/adapters/xano.ts",
  },
];

const BOUNDARY = {
  allowed: [
    "generate_document",
    "convert_document",
    "merge_documents",
    "ocr_document",
    "extract_data",
    "hash_document",
    "request_signature",
  ],
  withheld: [
    "apply_signature",
    "void_envelope",
    "file_regulatory_complaint",
  ],
};

export function JudgesBoard() {
  const { statuses, toggle } = useVendorStatuses();
  const [cases, setCases] = useState<Awaited<ReturnType<typeof api.cases>> | null>(null);

  useEffect(() => {
    api.cases().then(setCases).catch(() => {});
  }, []);

  const byVendor = Object.fromEntries(statuses.map((s) => [s.vendor, s]));

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <header className="border-b border-line pb-6">
        <a href="/" className="eyebrow text-accent underline-offset-4 hover:underline">
          ← Back to the demo
        </a>
        <h1 className="mt-4 text-[clamp(1.8rem,4vw,2.6rem)] leading-tight font-extrabold">
          What each API actually does here
        </h1>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-ink-dim">
          BillShield reads a hospital bill, finds the billing errors, prices them against published
          rates, writes a dispute letter, and takes it to a human signature. Six APIs each own one
          stage of that pipeline. Every one of them has a working built-in implementation to fall
          back on, and this page always says which of the two is running.
        </p>
      </header>

      <section className="mt-8">
        <h2 className="text-[18px] font-bold">Kill any vendor and re-run</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">
          Click a chip to switch that vendor off, then run the demo again. The pipeline completes
          either way — this page flips to <em>local</em> and the audit trail records why. That is the
          difference between a demo that survives a conference wifi outage and one that does not.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {statuses.map((s) => (
            <button
              key={s.vendor}
              onClick={() => toggle(s.vendor, !s.disabled)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-left transition hover:border-accent/60"
            >
              <ProvenanceChip
                provenance={s.mode === "live" ? "live" : "fallback"}
                label={s.label}
              />
              <div className="mt-1.5 text-[11px] text-muted">
                {s.disabled ? "switched off — click to restore" : s.reason}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-[18px] font-bold">Where each API does the real work</h2>
        {WORK.map((w) => {
          const status = byVendor[w.vendor];
          return (
            <Panel
              key={w.vendor}
              eyebrow={status?.mode === "live" ? "running live" : "running on the built-in implementation"}
              title={status?.label ?? w.vendor}
              right={
                status && (
                  <ProvenanceChip
                    provenance={status.mode === "live" ? "live" : "fallback"}
                    label={status.mode === "live" ? "live" : "local"}
                  />
                )
              }
            >
              <div className="space-y-3 px-5 py-4">
                <p className="text-[13px] leading-relaxed text-ink-dim">{w.did}</p>
                <p className="text-[13px] leading-relaxed">
                  <span className="eyebrow text-muted">Verify it: </span>
                  <span className="text-ink-dim">{w.verify}</span>
                </p>
                <p className="eyebrow text-muted">{w.where}</p>
              </div>
            </Panel>
          );
        })}
      </section>

      <section className="mt-10">
        <h2 className="text-[18px] font-bold">Where we put the signing boundary</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-dim">
          Foxit asks where the boundary belongs and invites an argument. Ours: the boundary does not
          belong at <em>signing</em> as an operation. It belongs at <strong>reversibility</strong>.
        </p>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-dim">
          Everything else in this pipeline is undoable. Generate the wrong letter, convert it, merge
          it, hash it — redo any of it and nothing in the world has changed. A signature is different
          in kind: it is the agent making a legal assertion in a person&apos;s name, and there is no
          undo. So an agent that gets confused, is prompt-injected by a malicious bill, or simply
          loops can waste tokens and produce a wrong letter. It cannot produce a{" "}
          <em>signed</em> one. The blast radius of every agent failure in this system stops at an
          unsigned PDF and a human who says no.
        </p>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-dim">
          One consequence worth naming: we hash the document <em>before</em> presenting it, not after
          signing. The signer sees the hash of what they are about to sign, and the same hash lands
          on the audit page. An agent that alters the document between preparation and signature
          invalidates its own envelope.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-accent/40 bg-accent/5 p-4">
            <div className="eyebrow text-accent">The agent may</div>
            <ul className="mt-2 space-y-1">
              {BOUNDARY.allowed.map((t) => (
                <li key={t} className="tnum text-[12px] text-ink-dim">
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-alert/40 bg-alert/5 p-4">
            <div className="eyebrow text-alert">Withheld from the agent</div>
            <ul className="mt-2 space-y-1">
              {BOUNDARY.withheld.map((t) => (
                <li key={t} className="tnum text-[12px] text-ink-dim">
                  {t}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] leading-relaxed text-muted">
              Enforced in code, not in a prompt: applySignature() requires a human confirmation, a
              single-use intent token, and a matching document hash.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-[18px] font-bold">Cases on record</h2>
        <p className="mt-2 text-[13px] text-ink-dim">
          Persisted through the Xano adapter{" "}
          {cases ? `(currently ${cases.provenance})` : ""}.
        </p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-line">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="eyebrow bg-surface-2 text-muted">
                <th className="px-4 py-2.5 text-left font-semibold">Case</th>
                <th className="px-4 py-2.5 text-left font-semibold">Patient</th>
                <th className="px-4 py-2.5 text-right font-semibold">Billed</th>
                <th className="px-4 py-2.5 text-right font-semibold">Disputed</th>
                <th className="px-4 py-2.5 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {(cases?.cases ?? []).map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="tnum px-4 py-2.5">{c.id}</td>
                  <td className="px-4 py-2.5">{c.patient}</td>
                  <td className="tnum px-4 py-2.5 text-right">
                    ${c.billedTotal.toLocaleString()}
                  </td>
                  <td className="tnum px-4 py-2.5 text-right text-accent">
                    ${c.disputedTotal.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="eyebrow text-muted">{c.status}</span>
                  </td>
                </tr>
              ))}
              {(cases?.cases.length ?? 0) === 0 && (
                <tr className="border-t border-line">
                  <td colSpan={5} className="px-4 py-6 text-center text-muted">
                    No cases yet — run the demo.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="mt-12 border-t border-line pt-6">
        <p className="text-[13px] text-muted">
          Run <code className="tnum text-ink-dim">pnpm smoke</code> to exercise every stage from the
          command line, including the two signing-boundary assertions.
        </p>
      </footer>
    </div>
  );
}
