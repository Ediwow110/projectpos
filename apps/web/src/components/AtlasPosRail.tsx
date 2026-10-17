"use client";

import Link from "next/link";
import type { JSX } from "react";

// Compact navigation mirrors the Atlas V4 register rail without hiding the
// full role-specific workspace (the logo returns to its normal dashboard).
const SHORTCUTS = [
  { href: "/pos", label: "SALE", caption: "New sale" },
  { href: "/inventory", label: "ITEMS", caption: "Inventory" },
  { href: "/orders", label: "ORDERS", caption: "Orders" },
  { href: "/shifts", label: "SHIFT", caption: "Shifts" },
] as const;

export function AtlasPosRail({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate: (href: string) => void;
}): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center bg-[#252e2b] px-2 pt-6 text-white">
      <Link href="/" aria-label="NexPOS dashboard"
        onClick={() => onNavigate("/")}
        className="grid h-[42px] w-[42px] place-items-center rounded-[11px] bg-[#da614c] font-display text-[23px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
        N
      </Link>
      <nav aria-label="Register navigation" className="mt-[56px] w-full space-y-7">
        {SHORTCUTS.map((shortcut) => {
          const active = pathname === shortcut.href;
          return (
            <Link key={shortcut.href} href={shortcut.href}
              title={shortcut.caption}
              aria-current={active ? "page" : undefined}
              onClick={() => { if (!active) onNavigate(shortcut.href); }}
              className={"flex min-h-[59px] w-full items-center justify-center rounded-[7px] text-[10px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffb7a4] " +
                (active ? "bg-[#39443e] font-semibold text-white" : "text-[#bdc7c0] hover:bg-[#39443e] hover:text-white")}
            >
              {shortcut.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
