"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
import { ApiError, apiFetch } from "../../lib/api";
import { shiftState, variancePresentation } from "../../lib/shift-view";
import { money, varianceLabel } from "../../lib/shifts";

interface Csrf {
  csrfToken: string;
}

interface Me {
  role: string;
  businessName?: string;
}

interface RegisterRow {
  id: string;
  name: string;
  isActive: boolean;
}

interface ShiftRow {
  id: string;
  registerId: string;
  branchId: string | null;
  status: string;
  openedBy: string;
  openingFloatMinor: number;
  countedCashMinor: number | null;
  varianceMinor: number | null;
  expectedCashMinor: number;
}

interface BranchRow {
  id: string;
  name: string;
}

const KINDS = ["paid_out", "cash_deposit", "cash_withdrawal", "adjustment"];

export default function ShiftsPage(): JSX.Element {
  const [registerId, setRegisterId] = useState("");
  const [openingFloat, setOpeningFloat] = useState("");
  const [kind, setKind] = useState("paid_out");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [counted, setCounted] = useState("");
  const [status, setStatus] = useState("");

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<Me>("/api/v1/me"),
    retry: false,
  });
  const registersQuery = useQuery({
    queryKey: ["registers"],
    queryFn: () => apiFetch<{ items: RegisterRow[] }>("/api/v1/registers"),
    retry: false,
  });
  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiFetch<{ items: BranchRow[] }>("/api/v1/branches"),
    retry: false,
  });
  const openQuery = useQuery({
    queryKey: ["shifts-open"],
    queryFn: () => apiFetch<{ items: ShiftRow[] }>("/api/v1/shifts?status=OPEN&limit=50"),
    retry: false,
  });
  const historyQuery = useQuery({
    queryKey: ["shifts-history"],
    queryFn: () => apiFetch<{ items: ShiftRow[] }>("/api/v1/shifts?limit=20"),
    retry: false,
  });

  async function mutate(path: string, init: RequestInit): Promise<{ id: string } & Record<string, unknown>> {
    const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
    const out = await apiFetch<{ id: string } & Record<string, unknown>>(path, { csrfToken: csrf.csrfToken, init });
    await openQuery.refetch();
    await historyQuery.refetch();
    return out;
  }

  async function openShift(): Promise<void> {
    setStatus("");
    try {
      const floatMinor = openingFloat.trim() === "" ? 0 : Math.round(Number(openingFloat) * 100);
      await mutate("/api/v1/registers/" + registerId + "/open", {
        method: "POST",
        body: JSON.stringify({ registerId, openingFloatMinor: floatMinor }),
      });
      setStatus("Shift opened.");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.code + ": " + err.message : "Open failed");
    }
  }

  async function recordCash(shiftId: string): Promise<void> {
    setStatus("");
    try {
      await mutate("/api/v1/shifts/" + shiftId + "/cash", {
        method: "POST",
        body: JSON.stringify({ kind, amountMinor: Math.round(Number(amount) * 100), reason }),
      });
      setAmount("");
      setReason("");
      setStatus("Cash movement recorded.");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.code + ": " + err.message : "Cash record failed");
    }
  }

  async function closeShift(shiftId: string): Promise<void> {
    setStatus("");
    try {
      const out = await mutate("/api/v1/shifts/" + shiftId + "/close", {
        method: "POST",
        body: JSON.stringify({ countedCashMinor: Math.round(Number(counted) * 100) }),
      });
      const report = (out as { report?: { variance?: number } }).report;
      setStatus("Shift closed. Variance: " + (typeof report?.variance === "number" ? varianceLabel(report.variance) : "unknown"));
      setCounted("");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.code + ": " + err.message : "Close failed");
    }
  }

  const registers = (registersQuery.data?.items ?? []).filter((register) => register.isActive);
  const openShifts = openQuery.data?.items ?? [];
  const history = historyQuery.data?.items ?? [];
  const branchName = (branchId: string | null | undefined): string =>
    branchId == null
      ? "No branch"
      : (branchesQuery.data?.items ?? []).find((branch) => branch.id === branchId)?.name ?? "Unknown branch";
  const expectedOpenCash = openShifts.reduce((sum, shift) => sum + shift.expectedCashMinor, 0);
  const closedVisible = history.filter((shift) => shift.status === "CLOSED").length;
  const reviewVisible = history.filter((shift) => shift.varianceMinor !== null && shift.varianceMinor !== 0).length;

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Operations / Shift control"
          title="Shifts"
          description="See which registers are open, what cash is expected, and which closes require human review."
        />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Shift summary">
          <MetricCard label="Active shifts" value={openShifts.length} icon="▤" tone="info" meta="Open register shifts" />
          <MetricCard label="Expected open cash" value={money(expectedOpenCash)} icon="▦" meta="Across open shifts" />
          <MetricCard label="Visible variance reviews" value={reviewVisible} icon="!" tone={reviewVisible > 0 ? "warning" : "success"} meta="Recent shift history" />
          <MetricCard label="Visible closed" value={closedVisible} icon="✓" tone="success" meta="Recent shift history" />
        </section>

        <Panel className="p-5">
          <SectionHeader title="Open a shift" description="Choose an active register and record the opening float before sales begin." />
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <label className="text-[11px] font-semibold text-[#655b53]">
              Register
              <select value={registerId} onChange={(event) => setRegisterId(event.target.value)} className="field mt-1.5">
                <option value="">Select register</option>
                {registers.map((register) => <option key={register.id} value={register.id}>{register.name}</option>)}
              </select>
            </label>
            <label className="text-[11px] font-semibold text-[#655b53]">
              Opening float
              <input value={openingFloat} onChange={(event) => setOpeningFloat(event.target.value)} placeholder="0.00" inputMode="decimal" className="field font-data mt-1.5" />
            </label>
            <PrimaryButton type="button" onClick={() => void openShift()} disabled={registerId === ""} className="self-end">Open shift</PrimaryButton>
          </div>
        </Panel>

        <section aria-label="Active shifts" className="grid gap-4 xl:grid-cols-2">
          {openShifts.length === 0 ? (
            <Panel className="p-6">
              <SectionHeader title="No open shifts" description="Open a register shift above when a cashier is ready to begin." />
            </Panel>
          ) : null}
          {openShifts.map((shift) => (
            <Panel key={shift.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-data text-[9px] uppercase tracking-[0.12em] text-[#9a8d83]">Shift {shift.id.slice(0, 8)}</p>
                  <h2 className="font-display mt-1 text-lg font-semibold"><Link href={"/shifts/" + shift.id} className="hover:text-[#d94a30]">{branchName(shift.branchId)}</Link></h2>
                </div>
                <StatusPill tone="info">Open</StatusPill>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-[#fcf8f3] p-3">
                  <dt className="text-[10px] text-[#73685f]">Opening float</dt>
                  <dd className="font-data mt-1 text-sm font-semibold">{money(shift.openingFloatMinor)}</dd>
                </div>
                <div className="rounded-xl bg-[#fcf8f3] p-3">
                  <dt className="text-[10px] text-[#73685f]">Expected cash</dt>
                  <dd className="font-data mt-1 text-sm font-semibold">{money(shift.expectedCashMinor)}</dd>
                </div>
              </dl>

              <div className="mt-4 border-t border-[#eee6de] pt-4">
                <p className="font-display text-sm font-semibold">Record cash movement</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <select value={kind} onChange={(event) => setKind(event.target.value)} className="field text-xs">
                    {KINDS.map((entry) => <option key={entry} value={entry}>{entry.replaceAll("_", " ")}</option>)}
                  </select>
                  <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="Amount" className="field font-data text-xs" />
                  <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason" className="field text-xs" />
                </div>
                <GhostButton type="button" onClick={() => void recordCash(shift.id)} className="mt-2 w-full">Record cash movement</GhostButton>
              </div>

              <div className="mt-4 border-t border-[#eee6de] pt-4">
                <p className="font-display text-sm font-semibold">Close & reconcile</p>
                <p className="mt-1 text-[10px] text-[#7a6f66]">Counted cash is compared with system-expected cash; the variance remains auditable.</p>
                <div className="mt-3 flex gap-2">
                  <input value={counted} onChange={(event) => setCounted(event.target.value)} inputMode="decimal" placeholder="Counted cash" className="field font-data" />
                  <PrimaryButton type="button" onClick={() => void closeShift(shift.id)}>Close shift</PrimaryButton>
                </div>
              </div>
            </Panel>
          ))}
        </section>

        <DataTableFrame>
          <div className="px-5 py-4">
            <h2 className="font-display text-base font-semibold">Recent shifts</h2>
            <p className="mt-1 text-[11px] text-[#7a6f66]">Immutable close outcomes remain visible with their variance state.</p>
          </div>
          <table className="premium-table min-w-[880px] text-left text-[12px]">
            <thead>
              <tr>
                <th className="px-5 pb-3">Shift</th>
                <th className="px-5 pb-3">Branch</th>
                <th className="px-5 pb-3 text-right">Expected</th>
                <th className="px-5 pb-3 text-right">Counted</th>
                <th className="px-5 pb-3 text-right">Variance</th>
                <th className="px-5 pb-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((shift) => {
                const state = shiftState(shift.status);
                const variance = shift.varianceMinor === null ? null : variancePresentation(shift.varianceMinor);
                return (
                  <tr key={shift.id}>
                    <td className="px-5 py-3"><Link href={"/shifts/" + shift.id} className="font-data font-medium hover:text-[#d94a30]">{shift.id.slice(0, 8)}</Link></td>
                    <td className="px-5 py-3 text-[#73685f]">{branchName(shift.branchId)}</td>
                    <td className="font-data px-5 py-3 text-right">{money(shift.expectedCashMinor)}</td>
                    <td className="font-data px-5 py-3 text-right">{shift.countedCashMinor === null ? "—" : money(shift.countedCashMinor)}</td>
                    <td className="px-5 py-3 text-right">
                      {variance ? <StatusPill tone={variance.tone}>{varianceLabel(variance.amount)}</StatusPill> : <span className="text-[#9a8d83]">—</span>}
                    </td>
                    <td className="px-5 py-3 text-right"><StatusPill tone={state.tone}>{state.label}</StatusPill></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataTableFrame>

        {status !== "" ? <p role="status" className="rounded-xl border border-[#eee4db] bg-white px-4 py-3 text-sm font-medium text-[#2a241f] shadow-[0_4px_14px_-6px_rgb(28_20_15/0.08)]">{status}</p> : null}
      </main>
    </AppShell>
  );
}
