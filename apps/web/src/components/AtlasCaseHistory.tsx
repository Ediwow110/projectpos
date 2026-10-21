"use client";

import Link from "next/link";
import type { JSX } from "react";

export interface AtlasCaseRecord {
  id: string;
  receiptNo: string;
  reason: string;
  requesterName?: string | null;
  status: string;
  requestedRefundMinor: number;
}

export function AtlasOwnerEscalation({ rows }: { rows: AtlasCaseRecord[] }): JSX.Element | null {
  const escalations = rows.filter((row) => row.status === "OWNER_REVIEW");
  if (escalations.length === 0) return null;
  const first = escalations[0]!;
  return (
    <section aria-labelledby="atlas-escalation-heading" className="rounded-xl border border-[#e7d6b2] bg-white p-5 sm:p-6">
      <span className="inline-block rounded-md bg-[#fcf1df] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-atlas-warning-strong)]">OWNER AUTHORIZATION</span>
      <h2 id="atlas-escalation-heading" className="mt-4 font-display text-[23px] font-semibold text-[#202826]">Owner escalation required</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--color-atlas-muted-strong)]">{escalations.length} customer case{escalations.length === 1 ? "" : "s"} require owner authorization. A manager cannot override this review by granting another approval.</p>
      <div className="mt-5 grid gap-3 border-y border-[#e5e9e3] py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div>
          <p className="text-[11px] text-[var(--color-atlas-muted-strong)]">Receipt needing review</p>
          <p className="mt-1 font-data text-sm font-semibold text-[#202826]">{first.receiptNo}</p>
          <p className="mt-1 text-xs text-[var(--color-atlas-muted-strong)]">Requested by {first.requesterName ?? "Staff member"} · {first.reason.replaceAll("_", " ").toLowerCase()}</p>
        </div>
        <span className="rounded-md bg-[#fcf1df] px-3 py-2 text-[11px] font-semibold text-[var(--color-atlas-warning-strong)]">OWNER REVIEW</span>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs leading-5 text-[var(--color-atlas-muted-strong)]">The original payment and stock remain unchanged. Your password is required when recording an owner decision; refund execution remains a separate protected step.</p>
        <Link href="#customer-case-decisions" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#29332d] px-5 text-[13px] font-semibold text-white hover:bg-[#405247] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c]">
          Review owner request
        </Link>
      </div>
    </section>
  );
}

export function AtlasCaseHistory({
  rows, loading, failed, canReview,
}: {
  rows: AtlasCaseRecord[];
  loading: boolean;
  failed: boolean;
  canReview: boolean;
}): JSX.Element {
  return (
    <section aria-label="Complaint and refund history" className="space-y-4">
      <div className="rounded-xl border border-[#e5e9e3] bg-white p-4 sm:p-5">
        <h2 className="font-display text-[20px] font-semibold text-[#202826]">{canReview ? "Customer case inbox" : "Customer case history"}</h2>
        <h3 className="mt-3 text-[15px] font-semibold text-[#202826]">Complaint &amp; refund history</h3>
        <p className="mt-1 text-xs text-[var(--color-atlas-muted-strong)]">Actual customer cases within your authorized workspace. Decisions and subsequent financial operations remain separate.</p>
        {loading ? <p role="status" className="mt-4 text-sm text-[var(--color-atlas-muted-strong)]">Loading customer case history…</p> : null}
        {failed ? <p role="alert" className="mt-4 text-sm text-[#a34132]">Customer case history is not available with your current access.</p> : null}
        {!loading && !failed && rows.length === 0 ? <p className="mt-4 rounded-lg bg-[#fafbf9] p-4 text-sm text-[var(--color-atlas-muted-strong)]">No customer cases in the current authorized scope.</p> : null}
        {!loading && !failed && rows.length > 0 ? <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-[12px]">
            <thead className="border-b border-[#e5e9e3] font-data text-[10px] tracking-[0.04em] text-[var(--color-atlas-muted-strong)]">
              <tr><th scope="col" className="px-2 py-3">CASE</th><th scope="col" className="px-2 py-3">RECEIPT</th><th scope="col" className="px-2 py-3">REASON</th><th scope="col" className="px-2 py-3">STAFF</th><th scope="col" className="px-2 py-3">STATUS</th></tr>
            </thead>
            <tbody>
              {rows.map((row, index) => <tr key={row.id} className={index % 2 === 0 ? "bg-[#fbfcfa]" : "bg-white"}>
                <td className="rounded-l-lg px-2 py-3 font-data text-[#202826]">{row.id.slice(0, 8)}</td>
                <td className="px-2 py-3 font-data text-[#202826]">{row.receiptNo}</td>
                <td className="px-2 py-3 text-[#202826]">{row.reason.replaceAll("_", " ").toLowerCase()}</td>
                <td className="px-2 py-3 text-[#202826]">{row.requesterName ?? "Staff member"}</td>
                <td className="rounded-r-lg px-2 py-3"><span className={"inline-block rounded-md px-2.5 py-1 font-semibold " + (row.status === "OWNER_REVIEW" || row.status === "PENDING" ? "bg-[#fcf1df] text-[var(--color-atlas-warning-strong)]" : row.status === "REJECTED" ? "bg-[#fff0eb] text-[#a34132]" : "bg-[#e8f4ec] text-[#267552]")}>{row.status.replaceAll("_", " ")}</span></td>
              </tr>)}
            </tbody>
          </table>
        </div> : null}
      </div>
    </section>
  );
}
