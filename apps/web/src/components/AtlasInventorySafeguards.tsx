import type { JSX, ReactNode } from "react";

export function AtlasInventorySafeguards({
  title, description, rules, children, alert,
}: {
  title: string;
  description: string;
  rules: readonly string[];
  children?: ReactNode;
  alert?: string;
}): JSX.Element {
  return <section aria-label={title} className="space-y-4">
    <header className="space-y-1">
      <p className="font-data text-[11px] font-medium tracking-[0.1em] text-[#267552]">INVENTORY CONTROLS / ATLAS 2026</p>
      <h2 className="font-display text-[30px] font-semibold tracking-tight text-[#202826]">{title}</h2>
      <p className="text-[13px] leading-5 text-[var(--color-atlas-muted-strong)]">{description}</p>
    </header>
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_269px]">
      <div className="min-w-0 rounded-[13px] border border-[#e5e9e3] bg-white p-5 sm:p-6">
        {alert ? <p className="mb-4 rounded-lg bg-[#fcf1df] px-3 py-2 text-xs font-semibold text-[var(--color-atlas-warning-strong)]">{alert}</p> : null}
        {children}
      </div>
      <aside aria-label={`${title} safeguards`} className="rounded-[13px] border border-[#e5e9e3] bg-white p-4 sm:p-5">
        <h3 className="font-display text-[22px] font-semibold text-[#202826]">Safeguards</h3>
        <ol className="mt-5 space-y-3">{rules.map((rule, index) => <li key={rule} className="flex min-h-20 gap-3 rounded-[9px] bg-[#f0f3ef] px-3 py-4 text-[13px] leading-5 text-[#202826]">
          <span className="font-data text-[12px] text-[#267552]">{String(index + 1).padStart(2, "0")}</span><span>{rule}</span>
        </li>)}</ol>
      </aside>
    </div>
  </section>;
}
