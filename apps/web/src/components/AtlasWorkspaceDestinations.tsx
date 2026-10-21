"use client";

import Link from "next/link";
import React from "react";
import type { JSX } from "react";
import { workspaceNavigationForRole } from "../lib/workspace-navigation";

/** Keeps role-authorized operational routes available when an Atlas task
 * sidebar replaces the normal workspace navigation. */
export function AtlasWorkspaceDestinations({
  role,
  onNavigate,
  excludedPaths = [],
}: {
  role: string;
  onNavigate: (href: string) => void;
  excludedPaths?: readonly string[];
}): JSX.Element {
  const groups = workspaceNavigationForRole(role).map((group) => ({
    ...group,
    items: group.items.filter((item) => !excludedPaths.includes(item.href)),
  })).filter((group) => group.items.length > 0);

  return (
    <details data-ui="atlas-workspace-destinations" className="mt-4 rounded-lg border border-[#e5e9e3] bg-[#f7f8f5]">
      <summary className="min-h-11 cursor-pointer px-4 py-3 text-[12px] font-semibold text-[#29332d] focus-visible:outline-2 focus-visible:outline-[#da614c]">
        All workspace destinations
      </summary>
      <nav aria-label="All workspace destinations" className="max-h-[40vh] space-y-3 overflow-y-auto border-t border-[#e5e9e3] px-3 py-3">
        {groups.map((group) => (
          <section key={group.label} aria-label={group.label}>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#758078]">{group.label}</p>
            {group.items.map((item) => (
              <Link key={item.href} href={item.href} data-tour={item.tour} onClick={() => onNavigate(item.href)}
                className="block min-h-11 rounded-lg px-3 py-2.5 text-[12px] text-[#202826] hover:bg-white focus-visible:outline-2 focus-visible:outline-[#da614c]">
                {item.label}
              </Link>
            ))}
          </section>
        ))}
      </nav>
    </details>
  );
}
