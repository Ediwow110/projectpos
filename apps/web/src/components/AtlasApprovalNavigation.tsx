"use client";

import Link from "next/link";
import type { JSX } from "react";
import { AtlasWorkspaceDestinations } from "./AtlasWorkspaceDestinations";

type AtlasLink = { readonly href: string; readonly label: string; readonly tour?: string };

/** `tour` reuses the workspace-navigation vocabulary. Approval inbox and order
 * exceptions stay unkeyed so the `sales` step resolves to the sales register. */
const DESTINATIONS: readonly AtlasLink[] = [
  { label: "Overview", href: "/", tour: "dashboard" },
  { label: "Approval inbox", href: "/customer-concerns" },
  { label: "Order exceptions", href: "/exceptions" },
  { label: "Shifts", href: "/shifts", tour: "shifts" },
  { label: "Refunds & sales", href: "/sales", tour: "sales" },
];

export function AtlasApprovalNavigation({
  pathname, role, onNavigate, onSignOut, signingOut,
}: {
  pathname: string;
  role: string;
  onNavigate: (href: string) => void;
  onSignOut: () => void;
  signingOut: boolean;
}): JSX.Element {
  const audit: AtlasLink = role === "owner"
    ? { label: "Activity audit", href: "/admin/owner-controls#activity-audit" }
    : { label: "Activity reports", href: "/reports/sales" };
  return (
    <div className="flex h-full min-h-[630px] flex-col overflow-y-auto bg-white px-3 pb-5 pt-6">
      <Link href="/" aria-label="NexPOS dashboard" className="mx-3 flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-[#da614c]">
        <span aria-hidden className="grid size-[43px] place-items-center rounded-[11px] bg-[#29332d] font-display text-[22px] font-semibold text-white">N</span>
        <span className="font-display text-[22px] font-semibold tracking-tight text-[#202826]">NexPOS</span>
      </Link>
      <p className="px-3 pb-5 pt-9 font-data text-[11px] font-medium tracking-[0.06em] text-[var(--color-atlas-muted-strong)]">APPROVAL &amp; OVERSIGHT</p>
      <nav aria-label="Approval navigation" className="space-y-1">
        {[...DESTINATIONS, audit].map((item) => {
          const active = pathname === item.href;
          return <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            data-tour={item.tour}
            onClick={() => { if (!active) onNavigate(item.href); }}
            className={"relative flex min-h-[46px] items-center rounded-lg px-[18px] text-[14px] transition-colors focus-visible:outline-2 focus-visible:outline-[#da614c] " +
              (active ? "bg-[#fff0eb] font-medium text-[var(--color-atlas-accent-strong)] before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-[#da614c]" : "text-[#202826] hover:bg-[#f0f3ef]")}
          >{item.label}</Link>;
        })}
      </nav>
      <AtlasWorkspaceDestinations role={role} onNavigate={onNavigate} excludedPaths={DESTINATIONS.map((item) => item.href)} />
      <div className="mt-auto space-y-1 border-t border-[#e5e9e3] px-3 pt-4">
        <Link href="/admin" className="block rounded-lg py-2 text-[13px] text-[var(--color-atlas-muted-strong)] hover:text-[#202826]">Support &amp; guide</Link>
        <button type="button" onClick={onSignOut} disabled={signingOut} className="w-full rounded-lg py-2 text-left text-[13px] text-[var(--color-atlas-muted-strong)] hover:text-[#202826] disabled:opacity-60">{signingOut ? "Signing out…" : "Sign out"}</button>
      </div>
    </div>
  );
}
