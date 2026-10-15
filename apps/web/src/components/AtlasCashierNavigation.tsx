"use client";

import Link from "next/link";
import type { JSX } from "react";

const LINKS = [
  { href: "/pos", label: "New sale" },
  { href: "/receipts/lookup", label: "Receipt lookup" },
  { href: "/customer-concerns", label: "Customer concerns" },
  { href: "/shifts", label: "My shifts" },
] as const;

export function AtlasCashierNavigation({
  pathname, onNavigate, onSignOut, signingOut,
}: {
  pathname: string;
  onNavigate: (href: string) => void;
  onSignOut: () => void;
  signingOut: boolean;
}): JSX.Element {
  return (
    <div className="flex h-full min-h-[630px] flex-col bg-white px-3 pb-5 pt-6">
      <Link href="/pos" aria-label="NexPOS cashier operations" className="mx-3 flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-[#da614c]">
        <span aria-hidden className="grid size-[43px] place-items-center rounded-[11px] bg-[#29332d] font-display text-[22px] font-semibold text-white">N</span>
        <span className="font-display text-[22px] font-semibold tracking-tight text-[#202826]">NexPOS</span>
      </Link>
      <p className="px-3 pb-5 pt-9 font-data text-[11px] font-medium tracking-[0.06em] text-[#748078]">CASHIER OPERATIONS</p>
      <nav aria-label="Cashier navigation" className="space-y-1">
        {LINKS.map((item) => {
          const active = item.href === "/customer-concerns"
            ? pathname.startsWith("/customer-concerns")
            : pathname === item.href;
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
              onClick={() => { if (!active) onNavigate(item.href); }}
              className={"relative flex min-h-[46px] items-center rounded-lg px-[18px] text-[14px] transition-colors focus-visible:outline-2 focus-visible:outline-[#da614c] " +
                (active ? "bg-[#fff0eb] font-medium text-[#da614c] before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-[#da614c]" : "text-[#202826] hover:bg-[#f0f3ef]")}
            >{item.label}</Link>
          );
        })}
      </nav>
      <div className="mt-auto border-t border-[#e5e9e3] px-3 pt-4">
        <button type="button" onClick={onSignOut} disabled={signingOut} className="w-full rounded-lg py-2 text-left text-[13px] text-[#748078] hover:text-[#202826] disabled:opacity-60">
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
