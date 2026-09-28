"use client";

import React from "react";
import type { JSX, ReactNode } from "react";

export function Card({ children, className = "", hover = false }: { children: ReactNode; className?: string; hover?: boolean }): JSX.Element {
  return (
    <div className={"rounded-2xl border border-[#eee4db] bg-white shadow-[0_4px_14px_-6px_rgb(28_20_15/0.08)] " + (hover ? "card-hover " : "") + className}>
      {children}
    </div>
  );
}

export function Peso({ minor, className = "", prefix = "₱" }: { minor: number; className?: string; prefix?: string }): JSX.Element {
  const v = (minor / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <span className={"money " + className}>{prefix}{v}</span>;
}

export function Delta({ deltaMinor, deltaPct, compareLabel }: { deltaMinor: number | null; deltaPct: number | null; compareLabel: string }): JSX.Element | null {
  if (deltaMinor === null) return null;
  const up = deltaMinor >= 0;
  return (
    <span className={"tnum inline-flex items-center gap-1 text-xs font-semibold " + (up ? "text-[#1f8a5b]" : "text-[#c43e3e]")}>
      <span aria-hidden>{up ? "↑" : "↓"}</span>
      {deltaPct !== null ? Math.abs(deltaPct).toFixed(1) + "%" : "—"}
      <span className="font-sans font-normal text-[#9a8d83]">vs. {compareLabel}</span>
    </span>
  );
}

export function StatusPill({ tone, children }: { tone: "ok" | "warn" | "bad" | "info"; children: ReactNode }): JSX.Element {
  const tones: Record<typeof tone, string> = {
    ok: "bg-[#eaf7f0] text-[#1f8a5b]",
    warn: "bg-[#fff4df] text-[#b56d0c]",
    bad: "bg-[#fff0f0] text-[#c43e3e]",
    info: "bg-[#edf3ff] text-[#3468d4]",
  };
  return <span data-tone={tone} className={"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold " + tones[tone]}>{children}</span>;
}

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const { className = "", ...rest } = props;
  return <button {...rest} className={"inline-flex min-h-10 items-center justify-center gap-2 rounded-[10px] bg-[#f35d3f] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] transition-[transform,background-color,box-shadow,opacity] duration-150 hover:bg-[#d94a30] active:scale-[0.98] motion-reduce:transform-none disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 " + className} />;
}

export function GhostButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const { className = "", ...rest } = props;
  return <button {...rest} className={"inline-flex min-h-10 items-center justify-center gap-2 rounded-[10px] border border-[#e4d9d0] bg-white px-4 py-2.5 text-sm font-semibold text-[#2a241f] transition-[transform,border-color,background-color,color,opacity] duration-150 hover:border-[#f35d3f] hover:text-[#d94a30] active:scale-[0.98] active:bg-[#fff8f5] motion-reduce:transform-none disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 " + className} />;
}

export function DangerButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const { className = "", ...rest } = props;
  return <button {...rest} className={"inline-flex min-h-10 items-center justify-center gap-2 rounded-[10px] border border-[#efb9b9] bg-[#fff0f0] px-4 py-2.5 text-sm font-semibold text-[#c43e3e] transition-[transform,border-color,background-color,opacity] duration-150 hover:border-[#c43e3e] active:scale-[0.98] active:bg-[#ffe8e8] motion-reduce:transform-none disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 " + className} />;
}
