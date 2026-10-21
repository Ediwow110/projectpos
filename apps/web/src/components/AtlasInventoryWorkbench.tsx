"use client";

import React from "react";
import Link from "next/link";
import type { JSX } from "react";
import { inventoryStatus } from "../lib/inventory-view";

export interface AtlasWorkbenchBalance {
  productId: string;
  productName: string;
  qtyOnHand: number;
  reorderLevel: number;
}

/**
 * Inventory workbench summaries are derived only from fetched stock balances.
 * Counts refer to the current result page, never invented cross-branch totals.
 */
export function AtlasInventoryWorkbench({
  items,
  total,
  branchName,
}: {
  items: AtlasWorkbenchBalance[];
  total: number;
  branchName: string | null;
}): JSX.Element {
  const low = items.filter((item) => inventoryStatus(item.qtyOnHand, item.reorderLevel) === "low");
  const out = items.filter((item) => inventoryStatus(item.qtyOnHand, item.reorderLevel) === "out");
  const attention = [...out, ...low].slice(0, 4);
  const cards = [
    { label: "Low stock (visible)", value: low.length },
    { label: "Out of stock (visible)", value: out.length },
    { label: "Products on this page", value: items.length },
  ];
  const next = [
    { label: "Start a count", href: "/inventory/counts" },
    { label: "Review reorder suggestions", href: "/inventory/replenishment" },
    { label: "Manager-protected adjustments", href: "/inventory/access" },
  ];
  return (
    <section aria-label="Inventory workbench" data-ui="atlas-inventory-workbench" className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-data text-[11px] font-medium tracking-wide text-[#267552]">OPERATIONS / MY WORK</p>
          <h1 className="font-display mt-2 text-[29px] font-semibold text-[#202826]">Inventory workbench</h1>
          <p className="mt-2 text-[14px] text-[var(--color-atlas-muted-strong)]">
            {branchName ? `Stock attention for ${branchName}.` : "Stock attention for your authorized branch scope."}
          </p>
        </div>
        <Link href="/inventory/counts" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#202826] px-5 text-[13px] font-semibold text-white hover:bg-[#37453d]">
          View assignments
        </Link>
      </header>
      <div className="grid gap-4 sm:grid-cols-3" aria-label="Visible stock metrics">
        {cards.map((card) => (
          <div key={card.label} className="min-h-[122px] rounded-xl border border-[#e5e9e3] bg-white px-5 py-5">
            <p className="font-display text-[28px] font-semibold text-[#202826]">{card.value}</p>
            <p className="mt-2 text-[13px] text-[var(--color-atlas-muted-strong)]">{card.label}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <section aria-label="Records and work items" className="min-h-[300px] rounded-xl border border-[#e5e9e3] bg-white p-5">
          <h2 className="font-display text-[21px] font-semibold text-[#202826]">Records &amp; work items</h2>
          <p className="mt-4 border-b border-[#e5e9e3] pb-3 font-data text-[10px] tracking-wide text-[var(--color-atlas-muted-strong)]">PRODUCT / ON HAND / STOCK STATE</p>
          {attention.length === 0 ? (
            <p className="mt-4 rounded-lg bg-[#eff2ed] p-4 text-[13px] text-[#53615a]">
              No low or out-of-stock products on this page. {total > items.length ? "Other pages may contain additional items." : "Review your regular count assignments."}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {attention.map((item) => (
                <li key={item.productId}>
                  <Link href={`/inventory/${encodeURIComponent(item.productId)}`}
                    className="flex min-h-[57px] items-center justify-between gap-3 rounded-lg bg-[#eff2ed] px-4 py-3 text-[12px] text-[#202826] hover:bg-[#e2ebe4]">
                    <span className="min-w-0 truncate font-semibold">{item.productName}</span>
                    <span className="shrink-0 text-right text-[#53615a]">
                      {item.qtyOnHand} on hand · {inventoryStatus(item.qtyOnHand, item.reorderLevel) === "out" ? "Out of stock" : "Low stock"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <a href="#inventory-balances" className="mt-4 inline-block rounded-lg py-2 text-[12px] font-semibold text-[#267552] hover:underline">Review stock balances</a>
        </section>
        <aside aria-label="Next inventory actions" className="rounded-xl border border-[#e5e9e3] bg-white p-5">
          <h2 className="font-display text-[21px] font-semibold text-[#202826]">Next actions</h2>
          <ol className="mt-7 space-y-3">
            {next.map((item, index) => (
              <li key={item.href}>
                <Link href={item.href} className="flex min-h-[64px] items-center gap-3 rounded-lg bg-[#eff2ed] px-4 text-[12px] text-[#202826] hover:bg-[#e2ebe4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#267552]">
                  <span className="font-data text-[#267552]">{String(index + 1).padStart(2, "0")}</span>{item.label}
                </Link>
              </li>
            ))}
          </ol>
        </aside>
      </div>
      <p className="text-[11px] text-[var(--color-atlas-muted-strong)]">Stock metrics reflect {items.length} of {total} products on the current query page. No sample figures are included.</p>
    </section>
  );
}
