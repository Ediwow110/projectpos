"use client";

import Link from "next/link";
import type { JSX, ReactNode } from "react";

const pages = [
  { href: "/platform/tenant-health", title: "Tenant health" },
  { href: "/platform/support-access", title: "Support access" },
] as const;

export function AtlasPlatformShell({ current, title, description, children }: {
  current: "health" | "support";
  title: string;
  description: string;
  children: ReactNode;
}): JSX.Element {
  return <div data-ui="atlas-platform-shell" className="min-h-screen bg-[#f7f8f5] text-[#202826] xl:grid xl:grid-cols-[233px_minmax(0,1fr)]">
    <aside aria-label="Platform navigation" className="bg-[#29332d] px-5 py-6 text-white xl:sticky xl:top-0 xl:h-screen">
      <Link href="/platform/tenant-health" className="font-display text-[18px] font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">NexPOS / PLATFORM</Link>
      <p className="mt-9 font-data text-[11px] tracking-[0.08em] text-[#c3d1c8]">PLATFORM ACCESS</p>
      <nav aria-label="Platform controls" className="mt-5 grid gap-1 sm:grid-cols-2 xl:grid-cols-1">
        {pages.map((entry) => <Link key={entry.href} href={entry.href} aria-current={current === (entry.href.endsWith("tenant-health") ? "health" : "support") ? "page" : undefined}
          className={"flex min-h-11 items-center rounded-lg px-3 text-[14px] transition-colors focus-visible:outline-2 focus-visible:outline-white " + (current === (entry.href.endsWith("tenant-health") ? "health" : "support") ? "bg-[#405247] text-white" : "text-[#c3d1c8] hover:bg-[#35453c] hover:text-white")}>{entry.title}</Link>)}
        <span className="px-3 py-2 text-[13px] text-[#90a098]">Security events</span>
        <span className="px-3 py-2 text-[13px] text-[#90a098]">Service status</span>
      </nav>
    </aside>
    <div className="min-w-0">
      <header className="flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-[#e5e9e3] bg-white px-5 py-3 sm:px-9">
        <span className="text-[13px] text-[#53615a]">Platform control / independent operator access</span>
        <span className="rounded-md bg-[#fcf1df] px-3 py-2 font-data text-[10px] font-semibold tracking-[0.06em] text-[#9a6e32]">SEPARATE TENANT CONTEXT</span>
      </header>
      <main className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-8 sm:px-9">
        <div>
          <p className="font-data text-[11px] font-medium tracking-[0.08em] text-[#da614c]">PLATFORM OPERATIONS / OWNER-CONSENTED</p>
          <h1 className="font-display mt-4 text-[30px] font-semibold tracking-tight text-[#202826]">{title}</h1>
          <p className="mt-2 text-[14px] text-[#748078]">{description}</p>
        </div>
        {children}
      </main>
    </div>
  </div>;
}
