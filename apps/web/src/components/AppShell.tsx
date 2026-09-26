"use client";

import React from "react";
import type { JSX, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DecorativeBackdrop } from "./premium";

const NAV: Array<{ href: string; label: string; icon: string }> = [
  { href: "/", label: "Dashboard", icon: "⌂" },
  { href: "/pos", label: "POS", icon: "▣" },
  { href: "/sales", label: "Sales", icon: "↗" },
  { href: "/products", label: "Products", icon: "◇" },
  { href: "/inventory", label: "Inventory", icon: "□" },
  { href: "/customers", label: "Customers", icon: "○" },
  { href: "/shifts", label: "Shifts", icon: "▤" },
  { href: "/reports/sales", label: "Reports", icon: "▥" },
  { href: "/branches", label: "Branches", icon: "⌘" },
  { href: "/billing", label: "Billing", icon: "▦" },
  { href: "/sync", label: "Sync", icon: "↻" },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

export function AppShell({
  children,
  businessName,
  role,
  offline,
  topbar,
  posMode = false,
}: {
  children: ReactNode;
  businessName?: string;
  role?: string;
  offline?: boolean;
  topbar?: ReactNode;
  posMode?: boolean;
}): JSX.Element {
  const pathname = usePathname();
  const today = new Date().toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  const name = businessName ?? "NexPOS";
  const initial = name.slice(0, 1).toUpperCase();
  const mobileHeaderHeight = posMode ? "min-h-[62px]" : "min-h-[60px]";

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#fcf8f3] xl:grid xl:grid-cols-[202px_minmax(0,1fr)]">
      <DecorativeBackdrop />

      <aside className="relative z-30 hidden h-screen px-6 py-10 pr-0 xl:sticky xl:top-0 xl:flex">
        <div className="flex min-h-0 w-full flex-col rounded-[18px] border border-white/80 bg-white p-3 shadow-[0_4px_14px_-6px_rgb(28_20_15/0.08)]">
          <div className="px-2 pb-5 pt-2">
            <p className="font-display text-[22px] font-bold leading-none text-[#17130f]">NEXPOS</p>
            <p className="font-data mt-2 text-[8px] font-medium tracking-[0.16em] text-[#9a8d83]">RETAIL OPERATIONS</p>
          </div>

          <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto" aria-label="Primary">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    "group relative flex min-h-[38px] items-center gap-2.5 rounded-[10px] px-2.5 text-[12px] font-medium transition " +
                    (active
                      ? "bg-[#fff0ea] font-semibold text-[#e44e34]"
                      : "text-[#3b342e] hover:bg-[#f7f1ea] hover:text-[#17130f]")
                  }
                >
                  {active ? <span aria-hidden className="absolute left-0 h-5 w-1 rounded-full bg-[#f35d3f]" /> : null}
                  <span
                    aria-hidden
                    className={
                      "grid h-[22px] w-[22px] place-items-center rounded-[7px] font-data text-[11px] " +
                      (active ? "bg-[#ffe3d8] text-[#e44e34]" : "bg-[#f4f0ea] text-[#635950]")
                    }
                  >
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-3 rounded-xl bg-[#fff6f1] p-2.5">
            <div className="flex items-center gap-2">
              <div className="font-display grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#f35d3f] text-xs font-bold text-white">
                {initial}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[10px] font-semibold text-[#2a241f]">{name}</p>
                <p className="truncate text-[8px] capitalize text-[#84786e]">{role ?? "owner"} · Main branch</p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="relative z-10 min-w-0">
        <div
          className={
            "sticky top-0 z-40 p-3 xl:px-3 xl:pb-[18px] xl:pt-10 " +
            (posMode ? "lg:max-xl:px-10 lg:max-xl:pb-6 lg:max-xl:pt-[30px]" : "lg:px-5 lg:pt-5")
          }
        >
          <header className={"mx-auto flex max-w-[1212px] items-center gap-3 rounded-2xl border border-white/80 bg-white/95 px-3 shadow-[0_4px_14px_-6px_rgb(28_20_15/0.08)] backdrop-blur xl:ml-0 xl:mr-auto xl:min-h-[60px] " + mobileHeaderHeight}>
            <Link href="/" className="font-display mr-1 text-base font-bold text-[#17130f] xl:hidden">NEXPOS</Link>

            <div className={posMode ? "hidden items-center gap-2 xl:flex" : "hidden items-center gap-2 sm:flex"}>
              <span className="rounded-[10px] bg-[#fcf8f3] px-3 py-2 text-[10px] font-semibold text-[#2a241f]">Main branch⌄</span>
              {offline !== undefined ? (
                <span
                  className={
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[9px] font-semibold " +
                    (offline ? "bg-[#fff4df] text-[#b56d0c]" : "bg-[#eaf7f0] text-[#1f8a5b]")
                  }
                >
                  <span aria-hidden>{offline ? "!" : "●"}</span>
                  {offline ? "Offline" : "Online"}
                </span>
              ) : null}
              <span className="hidden text-[10px] font-medium text-[#5d534b] md:inline">▣ Today</span>
              <span className="hidden text-[9px] text-[#8b8077] xl:inline">{today}</span>
            </div>

            {posMode && topbar ? (
              <div className="min-w-0 shrink-0 xl:ml-auto">
                {topbar}
              </div>
            ) : null}

            {posMode ? (
              <div data-ui="pos-tablet-header" className="flex min-w-0 items-center gap-2 xl:hidden">
                {offline !== undefined ? (
                  <span
                    className={
                      "inline-flex shrink-0 items-center gap-1 text-[8px] font-semibold " +
                      (offline ? "text-[#b56d0c]" : "text-[#1f8a5b]")
                    }
                  >
                    <span aria-hidden>●</span>
                    {offline ? "Offline" : "Online"}
                  </span>
                ) : null}
              </div>
            ) : (
              <nav aria-label="Mobile primary" className="ml-auto flex items-center gap-1 overflow-x-auto xl:hidden">
                {NAV.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={
                        "shrink-0 rounded-full px-2.5 py-1.5 text-[11px] font-semibold " +
                        (active ? "bg-[#fff0ea] text-[#e44e34]" : "text-[#5d534b]")
                      }
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            )}

            <div className={(posMode ? "hidden items-center gap-2 xl:flex" : "ml-auto hidden items-center gap-2 xl:flex")}>
              {!posMode ? topbar : null}
              <span aria-hidden className="text-sm text-[#2a241f]">⌕</span>
              <span aria-hidden className="text-sm text-[#2a241f]">♢</span>
              <div className="font-display grid h-8 w-8 place-items-center rounded-full bg-[#f35d3f] text-[11px] font-bold text-white">
                {initial}
              </div>
              <div className="max-w-36">
                <p className="truncate text-[9px] font-semibold text-[#2a241f]">{name}</p>
                <p className="truncate text-[8px] capitalize text-[#84786e]">{role ?? "owner"} · Main branch</p>
              </div>
            </div>
          </header>
        </div>

        <div className="relative z-10">{children}</div>
      </div>
    </div>
  );
}
