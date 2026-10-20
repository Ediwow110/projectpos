"use client";

import Link from "next/link";
import React, { type JSX } from "react";

/** Compact selling rail from Atlas V4. The API, not this navigation, enforces roles. */
export function AtlasPosRail({ pathname, onNavigate, onSignOut, signingOut = false }: {
  pathname: string;
  onNavigate: (href: string) => void;
  onSignOut?: () => void;
  signingOut?: boolean;
}): JSX.Element {
  const links = [
    { href: "/pos", label: "SALE" },
    { href: "/products", label: "ITEMS" },
    { href: "/orders", label: "ORDERS" },
    { href: "/shifts", label: "SHIFT" },
  ];
  return <div className="flex h-full min-h-[540px] flex-col items-center bg-[#252e2b] px-2 pt-6 text-white">
    <Link href="/" aria-label="NexPOS dashboard" onClick={() => onNavigate("/")}
      className="mb-14 grid size-[42px] place-items-center rounded-[11px] bg-[#da614c] font-display text-[23px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">N</Link>
    <nav aria-label="Cashier sale navigation" className="w-full space-y-6">
      {links.map((item) => <Link key={item.href} href={item.href}
        aria-current={pathname === item.href ? "page" : undefined}
        onClick={() => { if (pathname !== item.href) onNavigate(item.href); }}
        className={"flex min-h-[58px] items-center justify-center rounded-[7px] px-1 font-data text-[10px] tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-white " + (pathname === item.href ? "bg-[#39443e] text-white" : "text-[#dae2db] hover:bg-[#39443e]")}
      >{item.label}</Link>)}
    </nav>
    {onSignOut ? <button type="button" onClick={onSignOut} disabled={signingOut} aria-label="Sign out" title="Sign out"
      className="mt-auto mb-5 flex min-h-11 w-full items-center justify-center rounded-lg text-[11px] text-[#dae2db] hover:bg-[#39443e] disabled:opacity-50">{signingOut ? "…" : "Exit"}</button> : null}
  </div>;
}
