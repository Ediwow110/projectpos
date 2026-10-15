"use client";

import Link from "next/link";
import type { JSX } from "react";

const OWNER_SECTIONS = [
  { href: "/admin/owner-controls", label: "Overview" },
  { href: "/team", label: "Team & permissions" },
  { href: "/branches", label: "Branches & registers" },
  { href: "/admin/owner-controls#financial-policies", label: "Financial policies" },
  { href: "/customer-concerns", label: "Approval inbox" },
  { href: "/admin/support", label: "Guest support & consent" },
  { href: "/admin/owner-controls#security-sessions", label: "Security & sessions" },
  { href: "/admin/owner-controls#activity-audit", label: "Activity & audit" },
] as const;

export function AtlasOwnerNavigation({
  pathname,
  onNavigate,
  onSignOut,
  signingOut,
}: {
  pathname: string;
  onNavigate: (href: string) => void;
  onSignOut: () => void;
  signingOut: boolean;
}): JSX.Element {
  return (
    <div className="flex h-full min-h-[640px] flex-col bg-white px-3 pb-5 pt-6">
      <Link href="/admin/owner-controls" className="mx-3 flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c]" aria-label="NexPOS owner overview">
        <span aria-hidden className="grid h-[43px] w-[43px] place-items-center rounded-[11px] bg-[#202826] font-display text-[24px] font-bold text-white">N</span>
        <span className="font-display text-[22px] font-semibold tracking-tight text-[#202826]">NexPOS</span>
      </Link>
      <p className="px-3 pb-4 pt-9 font-data text-[11px] font-medium tracking-[0.07em] text-[#758078]">BUSINESS WORKSPACE</p>
      <nav aria-label="Owner navigation" className="space-y-1">
        {OWNER_SECTIONS.map((section, index) => {
          const active = section.href.includes("#")
            ? false
            : pathname === section.href || (index !== 0 && pathname.startsWith(`${section.href}/`));
          return (
            <Link
              key={section.label}
              href={section.href}
              aria-current={active ? "page" : undefined}
              onClick={() => {
                if (section.href.split("#")[0] !== pathname) onNavigate(section.href);
              }}
              className={
                "relative flex min-h-[48px] items-center rounded-lg px-[18px] text-[14px] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#da614c] " +
                (active ? "bg-[#fff0eb] font-semibold text-[#da614c] before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-[#da614c]" : "font-normal text-[#202826] hover:bg-[#f0f3ef]")
              }
            >
              {section.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto space-y-1 border-t border-[#e5e9e3] px-3 pt-4">
        <Link href="/admin" className="block rounded-lg py-2 text-[13px] text-[#758078] hover:text-[#202826]">Support & guide</Link>
        <button type="button" disabled={signingOut} onClick={onSignOut} className="w-full rounded-lg py-2 text-left text-[13px] text-[#758078] hover:text-[#202826] disabled:opacity-60">
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
