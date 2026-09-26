import React from "react";
import type { JSX, ReactNode } from "react";

export function DecorativeBackdrop(): JSX.Element {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -right-36 -top-44 h-[34rem] w-[34rem] rounded-full bg-[#ffd9c8]/55" />
      <div className="absolute -right-24 top-28 h-[23rem] w-[23rem] rounded-full bg-[#ff8061]/25" />
      <div className="absolute -bottom-48 -left-44 h-[28rem] w-[28rem] rounded-full bg-[#ffd7c7]/45" />
      <div className="absolute -bottom-24 left-4 h-64 w-64 rounded-full bg-[#f35d3f]/15" />
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }): JSX.Element {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? <p className="font-data text-[10px] font-medium uppercase tracking-[0.16em] text-[#f35d3f]">{eyebrow}</p> : null}
        <h1 className="font-display mt-1 text-[30px] font-bold leading-tight text-[#17130f] sm:text-[34px]">{title}</h1>
        {description ? <p className="mt-2 max-w-3xl text-[13px] leading-5 text-[#73685f]">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }): JSX.Element {
  return <section data-ui="panel" className={"rounded-2xl border border-[#eee4db] bg-white shadow-[0_10px_28px_-10px_rgb(28_20_15/0.10)] " + className}>{children}</section>;
}

export function SectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="font-display text-[16px] font-semibold text-[#17130f]">{title}</h2>
        {description ? <p className="mt-1 text-[11px] leading-4 text-[#7a6f66]">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function MetricCard({ label, value, icon, meta, tone = "coral", className = "" }: { label: string; value: ReactNode; icon: ReactNode; meta?: ReactNode; tone?: "coral" | "success" | "warning" | "info"; className?: string }): JSX.Element {
  const tones = {
    coral: "bg-[#fff0ea] text-[#f35d3f]",
    success: "bg-[#eaf7f0] text-[#1f8a5b]",
    warning: "bg-[#fff4df] text-[#b56d0c]",
    info: "bg-[#edf3ff] text-[#3468d4]",
  };
  return (
    <article data-ui="metric-card" className={"rounded-2xl border border-[#eee4db] bg-white p-4 shadow-[0_4px_14px_-6px_rgb(28_20_15/0.08)] " + className}>
      <div className="flex items-start gap-3">
        <span aria-hidden className={"grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-semibold " + tones[tone]}>{icon}</span>
        <div className="min-w-0">
          <p className="text-[11px] text-[#675c54]">{label}</p>
          <div className="font-display mt-1 text-[22px] font-semibold leading-none text-[#17130f]">{value}</div>
          {meta ? <div className="mt-2 text-[10px] font-semibold text-[#1f8a5b]">{meta}</div> : null}
        </div>
      </div>
    </article>
  );
}

export function DataTableFrame({ children, className = "" }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={"overflow-hidden rounded-2xl border border-[#eee4db] bg-white shadow-[0_10px_28px_-10px_rgb(28_20_15/0.10)] " + className}><div className="overflow-x-auto">{children}</div></div>;
}
