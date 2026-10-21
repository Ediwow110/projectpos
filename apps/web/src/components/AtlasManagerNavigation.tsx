"use client";

import Link from "next/link";
import React, { type JSX } from "react";
import { AtlasWorkspaceDestinations } from "./AtlasWorkspaceDestinations";

type AtlasSection = { readonly href: string; readonly label: string; readonly tour?: string };

/** `tour` reuses the workspace-navigation vocabulary so a guided tour step that
 * resolves in the legacy rail resolves here too. */
const MANAGER_SECTIONS: readonly AtlasSection[] = [
  { href: "/", label: "Overview", tour: "dashboard" },
  { href: "/sales", label: "Sales", tour: "sales" },
  { href: "/products", label: "Catalog", tour: "products" },
  { href: "/inventory", label: "Inventory", tour: "inventory" },
  { href: "/purchase-orders", label: "Procurement", tour: "purchase-orders" },
  { href: "/customers", label: "Customers", tour: "customers" },
  { href: "/shifts", label: "Team & shifts", tour: "shifts" },
  { href: "/reports/sales", label: "Reports", tour: "reports" },
  { href: "/customer-concerns", label: "Approval inbox" },
  { href: "/admin", label: "Administration", tour: "admin" },
];

export function AtlasManagerNavigation({
  pathname, onNavigate, onSignOut, signingOut,
}: {
  pathname: string;
  onNavigate: (href: string) => void;
  onSignOut: () => void;
  signingOut: boolean;
}): JSX.Element {
  return (
    <div className="flex h-full min-h-[640px] flex-col overflow-y-auto bg-white px-3 pb-5 pt-6">
      <Link href="/" aria-label="NexPOS manager overview" className="mx-3 flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-[#da614c]">
        <span aria-hidden className="grid size-[43px] place-items-center rounded-[11px] bg-[#202826] font-display text-[22px] font-semibold text-white">N</span>
        <span className="font-display text-[22px] font-semibold tracking-tight text-[#202826]">NexPOS</span>
      </Link>
      <p className="px-3 pb-4 pt-9 font-data text-[11px] font-medium tracking-[0.07em] text-[#748078]">MANAGER WORKSPACE</p>
      <nav aria-label="Manager navigation" className="space-y-1">
        {MANAGER_SECTIONS.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && item.href !== "/admin" && pathname.startsWith(item.href + "/"));
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              data-tour={item.tour}
              onClick={() => { if (!active) onNavigate(item.href); }}
              className={"relative flex min-h-[46px] items-center rounded-lg px-[18px] text-[14px] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-[#da614c] " +
                (active ? "bg-[#fff0eb] font-semibold text-[#da614c] before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-[#da614c]" : "text-[#202826] hover:bg-[#f0f3ef]")}
            >{item.label}</Link>
          );
        })}
      </nav>
      <AtlasWorkspaceDestinations role="manager" onNavigate={onNavigate} excludedPaths={MANAGER_SECTIONS.map((item) => item.href.split("#")[0])} />
      <div className="mt-auto space-y-1 border-t border-[#e5e9e3] px-3 pt-4">
        <Link href="/admin" className="block rounded-lg py-2 text-[13px] text-[#748078] hover:text-[#202826]">Support & guide</Link>
        <button type="button" onClick={onSignOut} disabled={signingOut} className="w-full rounded-lg py-2 text-left text-[13px] text-[#748078] hover:text-[#202826] disabled:opacity-60">{signingOut ? "Signing out…" : "Sign out"}</button>
      </div>
    </div>
  );
}
