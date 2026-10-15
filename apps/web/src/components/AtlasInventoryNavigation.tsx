"use client";

import Link from "next/link";
import type { JSX } from "react";
import { AtlasWorkspaceDestinations } from "./AtlasWorkspaceDestinations";

const INVENTORY_LINKS = [
  { href: "/inventory/counts", label: "Scan & count" },
  { href: "/purchase-orders", label: "Batch receiving" },
  { href: "/inventory/stock-exceptions", label: "Expiry & damage" },
  { href: "/inventory/replenishment", label: "Replenishment" },
  { href: "/inventory/access", label: "Restricted action" },
] as const;

export function AtlasInventoryNavigation({
  pathname, role, onNavigate, onSignOut, signingOut,
}: {
  pathname: string;
  role: string;
  onNavigate: (href: string) => void;
  onSignOut: () => void;
  signingOut: boolean;
}): JSX.Element {
  return <div className="flex h-full min-h-[630px] flex-col overflow-y-auto bg-white px-[13px] pb-5 pt-6">
    <Link href="/inventory/counts" aria-label="NexPOS inventory controls" className="mx-3 flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-[#267552]">
      <span aria-hidden className="grid size-[43px] place-items-center rounded-[10px] bg-[#29332d] font-display text-[22px] font-semibold text-white">N</span>
      <span className="font-display text-[22px] font-semibold tracking-tight text-[#202826]">NexPOS</span>
    </Link>
    <p className="px-3 pb-5 pt-9 font-data text-[11px] font-medium tracking-[0.06em] text-[#267552]">INVENTORY / 2026</p>
    <nav aria-label="Inventory controls" className="space-y-1">
      {INVENTORY_LINKS.map(({ href, label }) => {
        const active = pathname === href || (href === "/inventory/counts" && pathname.startsWith("/inventory/counts/"))
          || (href === "/purchase-orders" && pathname.startsWith("/purchase-orders/"));
        return <Link key={href} href={href} aria-current={active ? "page" : undefined}
          onClick={() => { if (!active) onNavigate(href); }}
          className={"flex min-h-[46px] items-center rounded-[8px] px-4 text-[14px] transition-colors focus-visible:outline-2 focus-visible:outline-[#267552] " +
            (active ? "bg-[#e9f4ec] font-medium text-[#267552]" : "text-[#202826] hover:bg-[#f0f3ef]")}>{label}</Link>;
      })}
    </nav>
    <AtlasWorkspaceDestinations role={role} onNavigate={onNavigate} excludedPaths={INVENTORY_LINKS.map((item) => item.href)} />
    <div className="mt-auto border-t border-[#e5e9e3] px-3 pt-4">
      <Link href="/inventory" className="block rounded-md py-2 text-[13px] text-[#53615a] hover:text-[#267552]">Inventory balances</Link>
      <button type="button" disabled={signingOut} onClick={onSignOut} className="w-full rounded-md py-2 text-left text-[13px] text-[#748078] hover:text-[#202826] disabled:opacity-60">{signingOut ? "Signing out…" : "Sign out"}</button>
    </div>
  </div>;
}
