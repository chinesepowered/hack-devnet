"use client";

import { useEffect, useRef, useState } from "react";

import type { Provenance, Severity } from "@/lib/types";

export function money(n: number, cents = false): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  })}`;
}

/** A number that counts up to its value. The reveal depends on this. */
export function CountUp({
  to,
  duration = 1400,
  prefix = "$",
  className = "",
}: {
  to: number;
  duration?: number;
  prefix?: string;
  className?: string;
}) {
  const [value, setValue] = useState(0);
  const frame = useRef<number>(0);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setValue(to);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // Ease-out cubic: fast at first, settles on the final number.
      setValue(to * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [to, duration]);

  return (
    <span className={`tnum ${className}`}>
      {prefix}
      {Math.round(value).toLocaleString("en-US")}
    </span>
  );
}

export function ProvenanceChip({
  provenance,
  label,
  title,
}: {
  provenance: Provenance | "system" | "human";
  label: string;
  title?: string;
}) {
  const styles: Record<string, string> = {
    live: "text-accent border-accent/45 bg-accent/10",
    cached: "text-info border-info/45 bg-info/10",
    fallback: "text-warn border-warn/45 bg-warn/10",
    system: "text-muted border-line-strong bg-surface-2",
    human: "text-info border-info/45 bg-info/10",
  };
  return (
    <span
      title={title}
      className={`eyebrow inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 ${styles[provenance] ?? styles.system}`}
    >
      <span
        className="h-1.5 w-1.5 rounded-full bg-current"
        style={{ opacity: provenance === "live" ? 1 : 0.55 }}
      />
      {label}
    </span>
  );
}

export function SeverityDot({ severity }: { severity: Severity }) {
  const color =
    severity === "high"
      ? "var(--alert)"
      : severity === "medium"
        ? "var(--warn)"
        : "var(--muted)";
  return (
    <span
      aria-label={`${severity} severity`}
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

/** Confidence rendered as a bar plus a number, because 0.87 alone means little. */
export function ConfidenceBar({ value, delay = 0 }: { value: number; delay?: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.9 ? "var(--accent)" : value >= 0.75 ? "var(--warn)" : "var(--alert)";
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative h-1 w-10 overflow-hidden rounded-full bg-line">
        <span
          className="animate-grow-x absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${pct}%`, background: color, animationDelay: `${delay}ms` }}
        />
      </span>
      <span className="tnum text-[11px]" style={{ color }}>
        {pct}%
      </span>
    </span>
  );
}

export function Panel({
  title,
  eyebrow,
  right,
  children,
  className = "",
  ref,
}: {
  title?: string;
  eyebrow?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Used by the studio to scroll each stage into view as it starts. */
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <section
      ref={ref as React.Ref<HTMLElement>}
      className={`scroll-mt-4 rounded-xl border border-line bg-surface ${className}`}
      style={{ boxShadow: "var(--shadow-sm)" }}
    >
      {(title || eyebrow || right) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            {eyebrow && <div className="eyebrow text-muted">{eyebrow}</div>}
            {title && <h2 className="mt-0.5 text-[15px] font-bold">{title}</h2>}
          </div>
          {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-45";
  const variants = {
    primary: "bg-accent text-[#04140e] hover:brightness-110 active:brightness-95",
    ghost: "border border-line-strong text-ink-dim hover:border-accent hover:text-ink",
    danger: "border border-alert/50 text-alert hover:bg-alert/10",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`animate-spin-slow inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent ${className}`}
    />
  );
}
