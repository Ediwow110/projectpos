"use client";

import React from "react";
import type { JSX, ReactNode } from "react";
import { formatMoneyMinor } from "../lib/money";

export function Card({ children, className = "", hover = false }: { children: ReactNode; className?: string; hover?: boolean }): JSX.Element {
  return (
    <div className={"rounded-2xl border border-[#eee4db] bg-white shadow-[0_4px_14px_-6px_rgb(28_20_15/0.08)] " + (hover ? "card-hover " : "") + className}>
      {children}
    </div>
  );
}

export function Peso({ minor, className = "", prefix = "₱" }: { minor: number; className?: string; prefix?: string }): JSX.Element {
  const v = formatMoneyMinor(minor);
  return <span className={"money " + className}>{prefix}{v}</span>;
}

// Delta labels are 12px mono text, so the up/compare foregrounds use the
// text-safe tokens: --color-success is 4.33:1 and --color-faint 3.22:1 on the
// white card, while --color-atlas-verified is 5.60:1 and
// --color-atlas-muted-strong 6.51:1.
export function Delta({ deltaMinor, deltaPct, compareLabel }: { deltaMinor: number | null; deltaPct: number | null; compareLabel: string }): JSX.Element | null {
  if (deltaMinor === null) return null;
  const up = deltaMinor >= 0;
  return (
    <span className={"tnum inline-flex items-center gap-1 text-xs font-semibold " + (up ? "text-[var(--color-atlas-verified)]" : "text-[#c43e3e]")}>
      <span aria-hidden>{up ? "↑" : "↓"}</span>
      {deltaPct !== null ? Math.abs(deltaPct).toFixed(1) + "%" : "—"}
      <span className="font-sans font-normal text-[var(--color-atlas-muted-strong)]">vs. {compareLabel}</span>
    </span>
  );
}

export function StatusPill({ tone, children }: { tone: "ok" | "warn" | "bad" | "info"; children: ReactNode }): JSX.Element {
  // The soft background carries the tone; the words use the text-safe tokens.
  // --color-success (3.93:1 on --color-success-soft) and --color-warning
  // (3.73:1 on --color-warning-soft) are below AA at this 12px size, so the
  // pill text uses --color-atlas-verified (5.08:1) and
  // --color-atlas-muted-strong (5.97:1) instead. danger/info already clear AA.
  const tones: Record<typeof tone, string> = {
    ok: "bg-[#eaf7f0] text-[var(--color-atlas-verified)]",
    warn: "bg-[#fff4df] text-[var(--color-atlas-muted-strong)]",
    bad: "bg-[#fff0f0] text-[#c43e3e]",
    info: "bg-[#edf3ff] text-[#3468d4]",
  };
  return <span data-tone={tone} className={"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold " + tones[tone]}>{children}</span>;
}

// The label is ink, not white: white on --color-coral measures 3.26:1 and the
// small semibold text needs 4.5:1. Hover therefore lifts to a lighter coral -
// darkening to --color-coral-hover would drop the ink label to 4.38:1.
export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const { className = "", ...rest } = props;
  return React.createElement("button", {
    ...rest,
    className: "inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-[var(--color-coral)] px-4 py-2.5 text-sm font-semibold text-[#17130f] shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] transition-[transform,background-color,box-shadow,opacity] duration-150 hover:bg-[#ff8061] active:scale-[0.98] motion-reduce:transform-none disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 " + className,
  });
}

// On hover the coral accent stays as the border (a non-text indicator) while
// the label moves to --color-atlas-accent-strong: --color-coral-hover measured
// 4.22:1 as hover text on white, the text-safe accent is 5.90:1.
export function GhostButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const { className = "", ...rest } = props;
  return React.createElement("button", {
    ...rest,
    className: "inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border border-[#e4d9d0] bg-white px-4 py-2.5 text-sm font-semibold text-[#2a241f] transition-[transform,border-color,background-color,color,opacity] duration-150 hover:border-[#f35d3f] hover:text-[var(--color-atlas-accent-strong)] active:scale-[0.98] active:bg-[#fff8f5] motion-reduce:transform-none disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 " + className,
  });
}

export function DangerButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const { className = "", ...rest } = props;
  return React.createElement("button", {
    ...rest,
    className: "inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border border-[#efb9b9] bg-[#fff0f0] px-4 py-2.5 text-sm font-semibold text-[#c43e3e] transition-[transform,border-color,background-color,opacity] duration-150 hover:border-[#c43e3e] active:scale-[0.98] active:bg-[#ffe8e8] motion-reduce:transform-none disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 " + className,
  });
}
