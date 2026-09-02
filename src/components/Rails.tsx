"use client";

import { useEffect, useState } from "react";

import { api, type VendorStatus } from "@/lib/client";
import { VENDOR_LABEL, type AuditTrailEntry, type Vendor } from "@/lib/types";
import { ProvenanceChip } from "./primitives";

/**
 * Vendor status bar.
 *
 * Always on screen. It states plainly which sponsor APIs are running live and
 * which are on the built-in fallback — so the demo never has to claim anything
 * the room can't verify, and a vendor outage becomes a feature rather than an
 * apology.
 */
export function VendorBar({
  statuses,
  onToggle,
  interactive = false,
}: {
  statuses: VendorStatus[];
  onToggle?: (vendor: Vendor, disabled: boolean) => void;
  interactive?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {statuses.map((s) => {
        const chip = (
          <ProvenanceChip
            provenance={s.mode === "live" ? "live" : "fallback"}
            label={s.label}
            title={`${s.role}\n${s.reason}`}
          />
        );
        if (!interactive || !onToggle) return <span key={s.vendor}>{chip}</span>;
        return (
          <button
            key={s.vendor}
            onClick={() => onToggle(s.vendor, !s.disabled)}
            title={s.disabled ? "Switch this vendor back on" : "Kill this vendor and use the fallback"}
            className="transition hover:opacity-75"
          >
            {chip}
          </button>
        );
      })}
    </div>
  );
}

export function useVendorStatuses() {
  const [statuses, setStatuses] = useState<VendorStatus[]>([]);

  const refresh = () => {
    api
      .health()
      .then((h) => setStatuses(h.vendors))
      .catch(() => setStatuses([]));
  };

  useEffect(refresh, []);

  const toggle = async (vendor: Vendor, disabled: boolean) => {
    await api.setVendor(vendor, disabled).catch(() => {});
    refresh();
  };

  return { statuses, refresh, toggle };
}

/**
 * The audit trail.
 *
 * Every step, in order, with the system that performed it and whether that was
 * live or fallback. Human decisions carry the person's name. This same list is
 * printed into the signed PDF, so what the screen shows and what the provider
 * receives are the same record.
 */
export function TrailRail({ trail }: { trail: AuditTrailEntry[] }) {
  return (
    <div className="scroll-thin max-h-full overflow-auto">
      <ol className="relative px-5 py-4">
        {trail.map((e, i) => (
          <li
            key={e.id}
            className="animate-slide-in relative pb-5 pl-6 last:pb-0"
            style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
          >
            {i < trail.length - 1 && (
              <span className="absolute top-4 bottom-0 left-[5px] w-px bg-line" />
            )}
            <span
              className="absolute top-1.5 left-0 h-2.5 w-2.5 rounded-full border-2"
              style={{
                borderColor:
                  e.actor
                    ? "var(--info)"
                    : e.provenance === "live"
                      ? "var(--accent)"
                      : e.provenance === "fallback"
                        ? "var(--warn)"
                        : "var(--muted)",
                background: "var(--surface)",
              }}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] font-semibold">{e.stage}</span>
              {e.vendor !== "system" && (
                <ProvenanceChip
                  provenance={e.provenance === "system" ? "system" : e.provenance}
                  label={VENDOR_LABEL[e.vendor as Vendor] ?? e.vendor}
                />
              )}
              {e.actor && <ProvenanceChip provenance="human" label={e.actor} />}
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">{e.detail}</p>
            <time className="eyebrow mt-1 block text-muted/70">
              {new Date(e.at).toLocaleTimeString()}
            </time>
          </li>
        ))}
      </ol>
    </div>
  );
}
