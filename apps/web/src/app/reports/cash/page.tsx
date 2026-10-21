"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ReportPageFrame } from "../../../components/ReportPageFrame";
import { DataTableFrame, MetricCard, Panel, SectionHeader } from "../../../components/premium";
import { StatusPill } from "../../../components/ui";
import { ApiError, apiFetch } from "../../../lib/api";
import { money } from "../../../lib/reports";

interface CashPayload { shifts: Array<{ shiftId: string; registerId: string; status: string; expectedCash: number; countedCash: number | null; variance: number | null }>; }

export default function CashReportPage(): JSX.Element {
  const query = useQuery({ queryKey: ["report-cash"], queryFn: () => apiFetch<CashPayload>("/api/v1/reports/cash?compare=none"), retry: false });
  const shifts = query.data?.shifts ?? [];
  const expected = shifts.reduce((sum, shift) => sum + shift.expectedCash, 0);
  const counted = shifts.reduce((sum, shift) => sum + (shift.countedCash ?? 0), 0);
  const variance = shifts.reduce((sum, shift) => sum + (shift.variance ?? 0), 0);
  const open = shifts.filter((shift) => shift.status === "OPEN").length;
  return <ReportPageFrame title="Cash report" description="Review expected cash, counted cash and variance per shift from the cash-control ledger.">{<section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Shifts" value={shifts.length} icon="▦" meta="Visible report rows" /><MetricCard label="Expected cash" value={money(expected)} icon="₱" meta="Across visible shifts" /><MetricCard label="Counted cash" value={money(counted)} icon="✓" tone="info" meta="Closed/countable rows" /><MetricCard label="Open shifts" value={open} icon="●" tone={open ? "warning" : "success"} meta={`Variance ${money(variance)}`} /></section>}{query.isLoading ? <Panel className="p-6 text-sm text-[#73685f]">Loading cash report…</Panel> : null}{query.isError ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-5"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{query.error instanceof ApiError ? `${query.error.code}: ${query.error.message}` : "Could not load report."}</p></Panel> : null}{query.data ? <DataTableFrame><div className="px-5 py-4"><SectionHeader title="Shift cash reconciliation" /></div>{shifts.length === 0 ? <p className="px-5 pb-8 text-sm text-[var(--color-atlas-muted-strong)]">No shifts recorded.</p> : <table className="premium-table min-w-[760px] text-left text-[12px]"><thead><tr><th className="px-5 pb-3">Shift</th><th className="px-5 pb-3">Status</th><th className="px-5 pb-3 text-right">Expected</th><th className="px-5 pb-3 text-right">Counted</th><th className="px-5 pb-3 text-right">Variance</th></tr></thead><tbody>{shifts.map((shift) => <tr key={shift.shiftId}><td className="px-5 py-3"><Link href={`/shifts/${shift.shiftId}`} className="font-semibold text-[#2a241f] hover:text-[var(--color-atlas-accent-strong)]">Shift {shift.shiftId.slice(0, 8)}</Link></td><td className="px-5 py-3"><StatusPill tone={shift.status === "OPEN" ? "warn" : "ok"}>{shift.status}</StatusPill></td><td className="font-data px-5 py-3 text-right">{money(shift.expectedCash)}</td><td className="font-data px-5 py-3 text-right">{shift.countedCash === null ? "—" : money(shift.countedCash)}</td><td className="font-data px-5 py-3 text-right">{shift.variance === null ? "—" : money(shift.variance)}</td></tr>)}</tbody></table>}</DataTableFrame> : null}</ReportPageFrame>;
}
