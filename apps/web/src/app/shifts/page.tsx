"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { Modal } from "../../components/Modal";
import { ManagerApprovalDialog } from "../../components/ManagerApprovalDialog";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
import { ApiError, apiFetch } from "../../lib/api";
import { shiftState, variancePresentation } from "../../lib/shift-view";
import { money, varianceLabel } from "../../lib/shifts";

interface Csrf { csrfToken: string; }
interface Me { role: string; businessName?: string; }
interface RegisterRow { id: string; name: string; isActive: boolean; }
interface BranchRow { id: string; name: string; }

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
  closeCandidate?: true;
}

const KINDS = ["paid_out", "cash_deposit", "cash_withdrawal", "adjustment"] as const;
type CashKind = (typeof KINDS)[number];

function cashKindLabel(kind: CashKind): string {
  return kind.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function amountToMinor(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const minor = Math.round(parsed * 100);
  return Number.isSafeInteger(minor) ? minor : null;
}

export default function ShiftsPage(): JSX.Element {
  const [openModal, setOpenModal] = useState(false);
  const [cashTarget, setCashTarget] = useState<ShiftRow | null>(null);
  const [closeTarget, setCloseTarget] = useState<ShiftRow | null>(null);
  const [registerId, setRegisterId] = useState("");
  const [openingFloat, setOpeningFloat] = useState("");
  const [kind, setKind] = useState<CashKind>("paid_out");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [counted, setCounted] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [closeApprovalOpen, setCloseApprovalOpen] = useState(false);

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const registersQuery = useQuery({ queryKey: ["registers"], queryFn: () => apiFetch<{ items: RegisterRow[] }>("/api/v1/registers"), retry: false });
  const branchesQuery = useQuery({ queryKey: ["branches"], queryFn: () => apiFetch<{ items: BranchRow[] }>("/api/v1/branches"), retry: false });
  const openQuery = useQuery({ queryKey: ["shifts-open", meQuery.data?.role], queryFn: () => apiFetch<{ items: ShiftRow[] }>(`/api/v1/shifts?status=OPEN&limit=50${meQuery.data?.role === "cashier" ? "&includeCloseCandidates=true" : ""}`), retry: false, enabled: meQuery.data !== undefined });
  const historyQuery = useQuery({ queryKey: ["shifts-history"], queryFn: () => apiFetch<{ items: ShiftRow[] }>("/api/v1/shifts?limit=20"), retry: false });

  async function mutate(path: string, init: RequestInit): Promise<{ id: string } & Record<string, unknown>> {
    const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
    const out = await apiFetch<{ id: string } & Record<string, unknown>>(path, { csrfToken: csrf.csrfToken, init });
    await Promise.all([openQuery.refetch(), historyQuery.refetch()]);
    return out;
  }

  async function openShift(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setStatus("");
    if (!registerId) {
      setStatus("VALIDATION: Select a register before opening a shift.");
      return;
    }
    const floatMinor = openingFloat.trim() === "" ? 0 : amountToMinor(openingFloat);
    if (floatMinor === null) {
      setStatus("VALIDATION: Opening float must be a non-negative amount.");
      return;
    }
    setBusy(true);
    try {
      await mutate(`/api/v1/registers/${registerId}/open`, { method: "POST", body: JSON.stringify({ registerId, openingFloatMinor: floatMinor }) });
      setOpenModal(false);
      setRegisterId("");
      setOpeningFloat("");
      setStatus("Shift opened.");
    } catch (err) {
      setStatus(err instanceof ApiError ? `${err.code}: ${err.message}` : "Open failed");
    } finally {
      setBusy(false);
    }
  }

  async function recordCash(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!cashTarget) return;
    setStatus("");
    const amountMinor = amountToMinor(amount);
    if (amountMinor === null || amountMinor <= 0) {
      setStatus("VALIDATION: Cash movement amount must be greater than zero.");
      return;
    }
    if (!reason.trim()) {
      setStatus("VALIDATION: A reason is required for cash movement.");
      return;
    }
    setBusy(true);
    try {
      await mutate(`/api/v1/shifts/${cashTarget.id}/cash`, { method: "POST", body: JSON.stringify({ kind, amountMinor, reason: reason.trim() }) });
      setCashTarget(null);
      setAmount("");
      setReason("");
      setKind("paid_out");
      setStatus("Cash movement recorded.");
    } catch (err) {
      setStatus(err instanceof ApiError ? `${err.code}: ${err.message}` : "Cash record failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitClose(approvalToken?: string): Promise<boolean> {
    if (!closeTarget) return false;
    setStatus("");
    const countedCashMinor = amountToMinor(counted);
    if (countedCashMinor === null) {
      setStatus("VALIDATION: Counted cash must be a non-negative amount.");
      return false;
    }
    setBusy(true);
    try {
      const out = await mutate(`/api/v1/shifts/${closeTarget.id}/close`, { method: "POST", body: JSON.stringify({ countedCashMinor, ...(approvalToken ? { approvalToken } : {}) }) });
      const report = (out as { report?: { variance?: number } }).report;
      setStatus(`Shift closed. Variance: ${typeof report?.variance === "number" ? varianceLabel(report.variance) : "unknown"}`);
      setCloseTarget(null);
      setCounted("");
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === "FORBIDDEN" && !approvalToken) {
        setCloseApprovalOpen(true);
      } else {
        setStatus(err instanceof ApiError ? `${err.code}: ${err.message}` : "Close failed");
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function closeShift(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await submitClose();
  }

  const registers = (registersQuery.data?.items ?? []).filter((register) => register.isActive);
  const openShifts = openQuery.data?.items ?? [];
  const history = historyQuery.data?.items ?? [];
  const branchName = (branchId: string | null | undefined): string => branchId == null ? "No branch" : (branchesQuery.data?.items ?? []).find((branch) => branch.id === branchId)?.name ?? "Unknown branch";
  const registerName = (id: string): string => (registersQuery.data?.items ?? []).find((register) => register.id === id)?.name ?? id.slice(0, 8);
  const ownOpenShifts = openShifts.filter((shift) => !shift.closeCandidate);
  const closeCandidates = openShifts.filter((shift) => shift.closeCandidate);
  const expectedOpenCash = ownOpenShifts.reduce((sum, shift) => sum + (shift.expectedCashMinor ?? 0), 0);
  const closedVisible = history.filter((shift) => shift.status === "CLOSED").length;
  const reviewVisible = history.filter((shift) => shift.varianceMinor !== null && shift.varianceMinor !== 0).length;

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Operations / Shift control"
          title="Shifts"
          description="See which registers are open, what cash is expected, and which closes require human review."
          actions={<><Link href="/registers" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">Registers</Link><PrimaryButton type="button" onClick={() => { setStatus(""); setOpenModal(true); }}>+ Open shift</PrimaryButton></>}
        />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Shift summary">
          <MetricCard label="Active shifts" value={ownOpenShifts.length} icon="▤" tone="info" meta="Open register shifts" />
          <MetricCard label="Expected open cash" value={money(expectedOpenCash)} icon="▦" meta="Across open shifts" />
          <MetricCard label="Visible variance reviews" value={reviewVisible} icon="!" tone={reviewVisible > 0 ? "warning" : "success"} meta="Recent shift history" />
          <MetricCard label="Visible closed" value={closedVisible} icon="✓" tone="success" meta="Recent shift history" />
        </section>

        {status ? <div role={status.includes(":") ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm font-medium ${status.includes(":") ? "border-[#efb9b9] bg-[#fff0f0] text-[#c43e3e]" : "border-[#cfe9dc] bg-[#eaf7f0] text-[var(--color-atlas-verified)]"}`}>{status}</div> : null}

        <section aria-label="Active shifts" className="grid gap-4 xl:grid-cols-2">
          {openQuery.isError ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-6"><p role="alert" className="text-sm font-medium text-[#c43e3e]">Open shifts could not be loaded, so this list is unknown rather than empty.</p><GhostButton type="button" className="mt-3" onClick={() => void openQuery.refetch()}>Retry</GhostButton></Panel> : null}
          {!openQuery.isError && ownOpenShifts.length === 0 && closeCandidates.length === 0 ? <Panel className="p-6"><SectionHeader title="No open shifts" description="Open a register shift when a cashier is ready to begin." /></Panel> : null}
          {ownOpenShifts.map((shift) => (
            <Panel key={shift.id} className="p-5">
              <div className="flex items-start justify-between gap-3"><div><p className="font-data text-[9px] uppercase tracking-[0.12em] text-[var(--color-atlas-muted-strong)]">Shift {shift.id.slice(0, 8)}</p><h2 className="font-display mt-1 text-lg font-semibold"><Link href={`/shifts/${shift.id}`} className="hover:text-[var(--color-atlas-accent-strong)]">{registerName(shift.registerId)}</Link></h2><p className="mt-1 text-[11px] text-[#73685f]">{branchName(shift.branchId)}</p></div><StatusPill tone="info">Open</StatusPill></div>
              <dl className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-[#fcf8f3] p-3"><dt className="text-[10px] text-[#73685f]">Opening float</dt><dd className="font-data mt-1 text-sm font-semibold">{money(shift.openingFloatMinor)}</dd></div><div className="rounded-xl bg-[#fcf8f3] p-3"><dt className="text-[10px] text-[#73685f]">Expected cash</dt><dd className="font-data mt-1 text-sm font-semibold">{money(shift.expectedCashMinor)}</dd></div></dl>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-[#eee6de] pt-4"><GhostButton type="button" onClick={() => { setStatus(""); setCashTarget(shift); setAmount(""); setReason(""); }}>Cash movement</GhostButton><PrimaryButton type="button" onClick={() => { setStatus(""); setCloseTarget(shift); setCounted(""); }}>Close shift</PrimaryButton><Link href={`/shifts/${shift.id}`} className="ml-auto inline-flex min-h-10 items-center text-[11px] font-semibold text-[var(--color-atlas-accent-strong)]">View report →</Link></div>
            </Panel>
          ))}
          {closeCandidates.map((shift) => <Panel key={shift.id} className="border-[#efd6a5] bg-[#fffdf8] p-5"><div className="flex items-start justify-between gap-3"><div><p className="font-data text-[9px] uppercase tracking-[0.12em] text-[var(--color-atlas-muted-strong)]">Manager review</p><h2 className="font-display mt-1 text-lg font-semibold">{registerName(shift.registerId)}</h2><p className="mt-1 text-[11px] text-[#73685f]">{branchName(shift.branchId)} · financial totals are intentionally hidden</p></div><StatusPill tone="warn">Approval required</StatusPill></div><div className="mt-4 border-t border-[#eee6de] pt-4"><PrimaryButton type="button" onClick={() => { setStatus(""); setCloseTarget(shift); setCounted(""); }}>Request close approval</PrimaryButton></div></Panel>)}
        </section>

        <DataTableFrame>
          <div className="px-5 py-4"><h2 className="font-display text-base font-semibold">Recent shifts</h2><p className="mt-1 text-[11px] text-[#7a6f66]">Close outcomes remain visible with their variance state.</p></div>
          {historyQuery.isError ? <div className="px-5 pb-8"><p role="alert" className="text-sm font-medium text-[#c43e3e]">Shift history could not be loaded, so closed shifts and their variances are unknown rather than absent.</p><GhostButton type="button" className="mt-3" onClick={() => void historyQuery.refetch()}>Retry</GhostButton></div> : history.length === 0 ? <p className="px-5 pb-8 text-sm text-[var(--color-atlas-muted-strong)]">No shift history yet.</p> : <table className="premium-table min-w-[880px] text-left text-[12px]"><thead><tr><th className="px-5 pb-3">Shift</th><th className="px-5 pb-3">Branch</th><th className="px-5 pb-3 text-right">Expected</th><th className="px-5 pb-3 text-right">Counted</th><th className="px-5 pb-3 text-right">Variance</th><th className="px-5 pb-3 text-right">Status</th></tr></thead><tbody>{history.map((shift) => { const state = shiftState(shift.status); const variance = shift.varianceMinor === null ? null : variancePresentation(shift.varianceMinor); return <tr key={shift.id}><td className="px-5 py-3"><Link href={`/shifts/${shift.id}`} className="font-data font-medium hover:text-[var(--color-atlas-accent-strong)]">{shift.id.slice(0, 8)}</Link></td><td className="px-5 py-3 text-[#73685f]">{branchName(shift.branchId)}</td><td className="font-data px-5 py-3 text-right">{money(shift.expectedCashMinor)}</td><td className="font-data px-5 py-3 text-right">{shift.countedCashMinor === null ? "—" : money(shift.countedCashMinor)}</td><td className="px-5 py-3 text-right">{variance ? <StatusPill tone={variance.tone}>{varianceLabel(variance.amount)}</StatusPill> : <span className="text-[var(--color-atlas-muted-strong)]">—</span>}</td><td className="px-5 py-3 text-right"><StatusPill tone={state.tone}>{state.label}</StatusPill></td></tr>; })}</tbody></table>}
        </DataTableFrame>
      </main>

      <Modal open={openModal} onClose={() => !busy && setOpenModal(false)} title="Open shift" description="Choose an active register and record the opening float before sales begin." footer={<div className="flex justify-end gap-2"><GhostButton type="button" onClick={() => setOpenModal(false)} disabled={busy}>Cancel</GhostButton><PrimaryButton type="submit" form="open-shift-form" disabled={busy || !registerId}>{busy ? "Opening…" : "Open shift"}</PrimaryButton></div>}>
        <form id="open-shift-form" noValidate onSubmit={(event) => void openShift(event)} className="space-y-4"><label className="block text-[11px] font-semibold text-[#655b53]">Register<select autoFocus value={registerId} onChange={(event) => setRegisterId(event.target.value)} className="field mt-1.5" required><option value="">Select register</option>{registers.map((register) => <option key={register.id} value={register.id}>{register.name}</option>)}</select></label><label className="block text-[11px] font-semibold text-[#655b53]">Opening float (PHP)<input value={openingFloat} onChange={(event) => setOpeningFloat(event.target.value)} inputMode="decimal" placeholder="0.00" className="field font-data mt-1.5" /></label>{status.includes(":") ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{status}</p> : null}</form>
      </Modal>

      <Modal open={cashTarget !== null} onClose={() => !busy && setCashTarget(null)} title="Record cash movement" description="Cash movements change expected shift cash and remain auditable. Record the real operational reason." footer={<div className="flex justify-end gap-2"><GhostButton type="button" onClick={() => setCashTarget(null)} disabled={busy}>Cancel</GhostButton><PrimaryButton type="submit" form="cash-movement-form" disabled={busy || !amount.trim() || !reason.trim()}>{busy ? "Recording…" : "Record movement"}</PrimaryButton></div>}>
        <form id="cash-movement-form" noValidate onSubmit={(event) => void recordCash(event)} className="space-y-4">{cashTarget ? <div className="rounded-xl bg-[#f7f1ea] p-4 text-sm"><p className="font-semibold text-[#2a241f]">{registerName(cashTarget.registerId)}</p><p className="font-data mt-1 text-[11px] text-[#73685f]">Expected cash {money(cashTarget.expectedCashMinor)}</p></div> : null}<label className="block text-[11px] font-semibold text-[#655b53]">Movement type<select value={kind} onChange={(event) => setKind(event.target.value as CashKind)} className="field mt-1.5">{KINDS.map((entry) => <option key={entry} value={entry}>{cashKindLabel(entry)}</option>)}</select></label><label className="block text-[11px] font-semibold text-[#655b53]">Amount (PHP)<input autoFocus value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className="field font-data mt-1.5" placeholder="0.00" /></label><label className="block text-[11px] font-semibold text-[#655b53]">Reason<input value={reason} onChange={(event) => setReason(event.target.value)} className="field mt-1.5" placeholder="Operational reason" /></label>{status.includes(":") ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{status}</p> : null}</form>
      </Modal>

      <Modal open={closeTarget !== null} onClose={() => !busy && setCloseTarget(null)} title="Close & reconcile shift" description="Count physical cash before confirming. The system compares counted cash with expected cash and records the variance." footer={<div className="flex justify-end gap-2"><GhostButton type="button" onClick={() => setCloseTarget(null)} disabled={busy}>Cancel</GhostButton><PrimaryButton type="submit" form="close-shift-form" disabled={busy || !counted.trim()}>{busy ? "Closing…" : "Close shift"}</PrimaryButton></div>}>
        <form id="close-shift-form" noValidate onSubmit={(event) => void closeShift(event)} className="space-y-4">{closeTarget ? <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-[#f7f1ea] p-4"><p className="text-[10px] text-[#73685f]">Register</p><p className="mt-1 text-sm font-semibold text-[#2a241f]">{registerName(closeTarget.registerId)}</p></div><div className="rounded-xl bg-[#f7f1ea] p-4"><p className="text-[10px] text-[#73685f]">Expected cash</p><p className="font-data mt-1 text-sm font-semibold text-[#2a241f]">{closeTarget.closeCandidate ? "Shown after approval" : money(closeTarget.expectedCashMinor ?? 0)}</p></div></div> : null}<label className="block text-[11px] font-semibold text-[#655b53]">Counted cash (PHP)<input autoFocus value={counted} onChange={(event) => setCounted(event.target.value)} inputMode="decimal" className="field font-data mt-1.5" placeholder="0.00" /></label><div className="rounded-xl bg-[#fff4df] p-3 text-[11px] leading-5 text-[#8a5606]">Closing a shift is consequential. The counted amount and resulting variance remain part of the audit trail.</div>{status.includes(":") ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{status}</p> : null}</form>
      </Modal>
      {closeTarget ? <ManagerApprovalDialog open={closeApprovalOpen} permission="shift.close.override" action={{ kind: "shift_close", shiftId: closeTarget.id, countedCashMinor: amountToMinor(counted) ?? 0 }} registerId={closeTarget.registerId} queueEnabled={meQuery.data?.role === "cashier"} title={`Manager approval · approve shift close override on ${registerName(closeTarget.registerId)}`} description="Closing a shift opened by another staff member requires a current manager approval." summary={`${registerName(closeTarget.registerId)} · counted cash ${counted || "0.00"} PHP`} onApproved={(grant) => submitClose(grant.token)} onClose={() => setCloseApprovalOpen(false)} /> : null}
    </AppShell>
  );
}
