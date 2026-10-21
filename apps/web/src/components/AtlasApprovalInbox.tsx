"use client";

import type { JSX } from "react";

export interface AtlasApprovalRow {
  id: string;
  status: string;
  requesterName?: string | null;
  branchName?: string | null;
  registerName?: string | null;
  action: { kind: string };
  context?: { saleReceiptNo?: string; productName?: string; countNumber?: string } | null;
}

const SALES_ACTIONS = new Set(["discount", "refund", "sale_void"]);
const TITLES: Record<string, string> = {
  discount: "Discount override",
  refund: "Refund approval",
  sale_void: "Sale void",
  shift_close: "Cash variance",
  inventory_movement: "Inventory adjustment",
  inventory_count: "Stock count",
  value_adjustment: "Stored value adjustment",
};

export function AtlasApprovalInbox({ rows, loading, failed, onRetry }: {
  rows: AtlasApprovalRow[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}): JSX.Element {
  const pending = rows.filter((row) => row.status === "PENDING");
  const sales = pending.filter((row) => SALES_ACTIONS.has(row.action.kind)).length;
  const tiles = [
    { label: "PENDING DECISIONS", value: pending.length, detail: "Needs authorized review" },
    { label: "SALES REQUESTS", value: sales, detail: "Discount, refund and void" },
    { label: "OTHER REQUESTS", value: pending.length - sales, detail: "Shift, stock and value actions" },
  ];
  return (
    <section aria-label="Approval overview" className="space-y-5">
      <section aria-label="Mobile approval requests" className="space-y-4 pb-4 sm:hidden">
        <div className="space-y-2">
          <h2 className="sr-only">Pending approval requests</h2>
          <p role="status" className="text-[15px] text-[var(--color-atlas-muted-strong)]">{loading ? "Loading requests…" : failed ? "Requests unavailable" : `${pending.length} request${pending.length === 1 ? "" : "s"} waiting`}</p>
        </div>
        {!loading && !failed && pending.length > 0 ? <ul className="space-y-3" aria-label="Mobile pending approvals">
          {pending.map((row) => <li key={row.id}>
            <a href={`#manager-approval-${row.id}`} className="block min-h-[137px] rounded-[11px] border border-[#e5e9e3] bg-white p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c]">
              <h3 className="font-display text-[18px] font-semibold text-[#202826]">{TITLES[row.action.kind] ?? row.action.kind.replaceAll("_", " ")}</h3>
              <p className="mt-2 line-clamp-2 text-[13px] text-[var(--color-atlas-muted-strong)]">{row.context?.saleReceiptNo ? `Receipt ${row.context.saleReceiptNo}` : row.context?.productName ?? row.context?.countNumber ?? row.branchName ?? "Protected transaction"} · {row.requesterName ?? "Staff member"}</p>
              <div className="mt-4 flex items-center justify-between gap-3"><span className="rounded-md bg-[#fcf1df] px-3 py-2 text-[11px] font-semibold text-[var(--color-atlas-warning-strong)]">Pending</span><span className="text-[13px] font-semibold text-[var(--color-atlas-accent-strong)]">Review →</span></div>
            </a>
          </li>)}
        </ul> : null}
        {!loading && !failed && pending.length === 0 ? <p className="rounded-lg bg-white p-4 text-[13px] text-[var(--color-atlas-muted-strong)]">No requests are waiting within your assigned scope.</p> : null}
        <a href="#manager-approval-details" className="fixed inset-x-5 bottom-5 z-40 flex min-h-[53px] items-center justify-center rounded-lg bg-[#29332d] px-4 text-[14px] font-semibold text-white shadow-[0_0_0_14px_#f7f8f5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c] sm:static sm:shadow-none">Open request review</a>
      </section>
      <div className="hidden gap-4 sm:grid sm:grid-cols-3">
        {tiles.map((tile) => <div key={tile.label} className="min-h-[109px] rounded-xl border border-[#e5e9e3] bg-white px-[17px] py-4">
          <p className="text-[11px] font-semibold text-[var(--color-atlas-muted-strong)]">{tile.label}</p>
          <p className="mt-1 font-display text-[29px] font-semibold text-[#202826]">{loading || failed ? "—" : tile.value}</p>
          <p className="mt-1 text-[12px] text-[var(--color-atlas-muted-strong)]">{tile.detail}</p>
        </div>)}
      </div>
      <div className="grid items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_254px]">
        <section aria-labelledby="atlas-approval-queue-heading" className="hidden min-h-[447px] flex-col rounded-xl border border-[#e5e9e3] bg-white p-4 sm:flex sm:p-5">
          <h2 id="atlas-approval-queue-heading" className="font-display text-[22px] font-semibold text-[#202826]">Awaiting approval</h2>
          <p className="mt-6 border-b border-[#e5e9e3] pb-3 font-data text-[11px] tracking-[0.04em] text-[var(--color-atlas-muted-strong)]">REQUEST / REASON / STAFF / SCOPE</p>
          {loading ? <p role="status" className="mt-6 text-sm text-[var(--color-atlas-muted-strong)]">Loading protected requests…</p> : null}
          {failed ? <div className="mt-5"><p role="alert" className="text-sm text-[#a34132]">The approval queue could not be loaded.</p><button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-[#e5e9e3] px-4 py-2 text-sm font-semibold">Try again</button></div> : null}
          {!loading && !failed && pending.length === 0 ? <p className="mt-6 rounded-lg bg-[#f7f8f5] p-4 text-sm text-[var(--color-atlas-muted-strong)]">No pending decisions within your current permissions and branch scope.</p> : null}
          {!loading && !failed ? <ul aria-label="Pending approval requests" className="mt-4 space-y-2">{pending.slice(0, 3).map((row) => <li key={row.id}>
            <a href={`#manager-approval-${row.id}`} className="flex min-h-[80px] flex-wrap items-center gap-3 rounded-lg bg-[#fbfcfa] px-4 py-3 transition-colors hover:bg-[#f0f3ef] focus-visible:outline-2 focus-visible:outline-[#da614c]">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-[#202826]">{TITLES[row.action.kind] ?? row.action.kind.replaceAll("_", " ")}</p>
                <p className="mt-1 truncate text-[12px] text-[var(--color-atlas-muted-strong)]">{row.context?.saleReceiptNo ? `Receipt ${row.context.saleReceiptNo}` : row.context?.productName ?? row.context?.countNumber ?? row.branchName ?? "Protected transaction"} · {row.registerName ?? "No register"}</p>
              </div>
              <div className="min-w-0 max-w-40 text-right">
                <p className="truncate text-[12px] text-[#202826]">{row.requesterName ?? "Staff member"}</p>
                <span className="mt-1 inline-block rounded-md bg-[#fcf1df] px-3 py-1 text-[11px] font-semibold text-[var(--color-atlas-warning-strong)]">Pending</span>
              </div>
            </a>
          </li>)}</ul> : null}
          <a href="#manager-approval-details" className="mt-auto self-end rounded-lg bg-[#29332d] px-6 py-3 text-center text-[13px] font-semibold text-white transition-colors hover:bg-[#405247] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c]">Review requests</a>
        </section>
        <aside aria-labelledby="atlas-approval-controls-heading" className="min-h-[447px] rounded-xl border border-[#e5e9e3] bg-white p-4">
          <h2 id="atlas-approval-controls-heading" className="font-display text-[20px] font-semibold text-[#202826]">Approval controls</h2>
          <ul className="mt-9 space-y-3 text-[12px] leading-5 text-[#202826]">
            {[
              "Each request stays tied to its original transaction and scope.",
              "Only reviewers with matching permissions may make decisions.",
              "Approval requires the reviewer's verified credentials.",
              "Approval grants one retry; it does not execute the protected action.",
            ].map((rule) => <li key={rule} className="min-h-[66px] rounded-lg bg-[#f0f3ef] px-3 py-3">{rule}</li>)}
          </ul>
          <span className="mt-3 inline-block rounded-md bg-[#e8f4ec] px-3 py-1.5 text-[11px] font-semibold text-[#267552]">ONE-USE GRANT</span>
        </aside>
      </div>
    </section>
  );
}
