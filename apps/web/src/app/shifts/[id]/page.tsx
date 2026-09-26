"use client";

import type { JSX } from "react";
import Link from "next/link";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../../components/AppShell";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../../components/premium";
import { StatusPill } from "../../../components/ui";
import { ApiError, apiFetch } from "../../../lib/api";
import { money, varianceLabel } from "../../../lib/shifts";

interface Me {
  role: string;
  businessName?: string;
}

interface MovementRow {
  id: string;
  type: string;
  amountMinor: number;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  actorId: string;
}

interface ShiftReport {
  shift: {
    id: string;
    status: string;
    openedBy: string;
    closedBy: string | null;
    openingFloatMinor: number;
  };
  components: {
    openingFloat: number;
    cashSales: number;
    cashRefunds: number;
    cashExpenses: number;
    cashDeposits: number;
    cashWithdrawals: number;
    adjustments: number;
    expectedCash: number;
    countedCash: number | null;
    variance: number | null;
  };
  movements: MovementRow[];
}

function movementLabel(type: string): string {
  return type.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function ShiftDetailPage({ params }: { params: Promise<{ id: string }> }): JSX.Element {
  const { id } = use(params);
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const reportQuery = useQuery({
    queryKey: ["shift", id],
    queryFn: () => apiFetch<ShiftReport>(`/api/v1/shifts/${id}`),
    retry: false,
  });

  if (reportQuery.isError) {
    return (
      <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
        <main className="mx-auto max-w-[1240px] p-6">
          <Panel className="border-[#efb9b9] bg-[#fff0f0] p-6">
            <p role="alert" className="text-sm font-medium text-[#c43e3e]">
              {reportQuery.error instanceof ApiError ? `${reportQuery.error.code}: ${reportQuery.error.message}` : "Shift not found."}
            </p>
            <Link href="/shifts" className="mt-3 inline-block text-sm font-semibold text-[#e44e34]">← Back to shifts</Link>
          </Panel>
        </main>
      </AppShell>
    );
  }

  const report = reportQuery.data;
  const shift = report?.shift;
  const c = report?.components;
  const movements = report?.movements ?? [];

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Cash control / Shift report"
          title={shift ? `Shift ${shift.id.slice(0, 8)}` : "Shift report"}
          description="Reconcile opening float, cash movement, expected cash, counted cash and variance from the authoritative shift ledger."
          actions={<Link href="/shifts" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">← Shifts</Link>}
        />

        {shift && c ? (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Shift summary">
              <MetricCard label="Expected cash" value={money(c.expectedCash)} icon="₱" meta="Ledger-derived" />
              <MetricCard label="Counted cash" value={c.countedCash === null ? "—" : money(c.countedCash)} icon="▦" tone="info" meta={shift.status === "OPEN" ? "Not closed yet" : "Close count"} />
              <MetricCard label="Variance" value={c.variance === null ? "Open" : varianceLabel(c.variance)} icon="↕" tone={c.variance === null || c.variance === 0 ? "success" : "warning"} meta="Counted minus expected" />
              <MetricCard label="Status" value={<span className="text-base">{shift.status}</span>} icon={shift.status === "OPEN" ? "●" : "✓"} tone={shift.status === "OPEN" ? "warning" : "success"} meta={`Opened by ${shift.openedBy.slice(0, 8)}`} />
            </section>

            <Panel className="p-5">
              <SectionHeader title="Cash components" description="These components roll up into expected cash for the shift." />
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ["Opening float", c.openingFloat],
                  ["Cash sales", c.cashSales],
                  ["Cash refunds", c.cashRefunds],
                  ["Cash expenses", c.cashExpenses],
                  ["Deposits", c.cashDeposits],
                  ["Withdrawals", c.cashWithdrawals],
                  ["Adjustments", c.adjustments],
                  ["Expected cash", c.expectedCash],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl bg-[#f7f1ea] p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a8d83]">{label}</p>
                    <p className="font-data mt-1 text-sm font-semibold text-[#2a241f]">{money(Number(value))}</p>
                  </div>
                ))}
              </div>
            </Panel>

            <DataTableFrame>
              <div className="px-5 py-4"><SectionHeader title="Cash movements" description="Each movement preserves its type, amount, actor and reference where available." /></div>
              {movements.length === 0 ? <p className="px-5 pb-8 text-sm text-[#8b8077]">No movements recorded.</p> : (
                <table className="premium-table min-w-[760px] text-left text-[12px]">
                  <thead><tr><th className="px-5 pb-3">Type</th><th className="px-5 pb-3">Reason</th><th className="px-5 pb-3">Actor</th><th className="px-5 pb-3 text-right">Amount</th><th className="px-5 pb-3 text-right">Reference</th></tr></thead>
                  <tbody>
                    {movements.map((movement) => (
                      <tr key={movement.id}>
                        <td className="px-5 py-3"><StatusPill tone={movement.amountMinor < 0 ? "warn" : "info"}>{movementLabel(movement.type)}</StatusPill></td>
                        <td className="px-5 py-3 text-[#73685f]">{movement.reason ?? "—"}</td>
                        <td className="font-data px-5 py-3 text-[#9a8d83]">{movement.actorId.slice(0, 8)}</td>
                        <td className="font-data px-5 py-3 text-right font-semibold">{money(movement.amountMinor)}</td>
                        <td className="px-5 py-3 text-right">{movement.referenceType === "Sale" && movement.referenceId ? <Link href={`/receipts/${movement.referenceId}`} className="text-[11px] font-semibold text-[#e44e34]">Receipt →</Link> : <span className="font-data text-[10px] text-[#9a8d83]">{movement.referenceType ?? "—"}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </DataTableFrame>
          </>
        ) : <Panel className="p-6 text-sm text-[#73685f]">Loading shift…</Panel>}
      </main>
    </AppShell>
  );
}
