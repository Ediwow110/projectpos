"use client";

import type { JSX } from "react";
import Link from "next/link";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../../../components/AppShell";
import { ManagerApprovalDialog, type ManagerApprovalGrant } from "../../../../components/ManagerApprovalDialog";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../../../components/premium";
import { PrimaryButton, StatusPill } from "../../../../components/ui";
import { ApiError, apiFetch } from "../../../../lib/api";
import { formatMoneyMinor } from "../../../../lib/money";

interface Me { role: string; businessName?: string; permissions?: string[] }
interface Customer { id: string; name: string }
interface HistoryRow { id: string; type: string; amountDeltaMinor?: number; pointsDelta?: number; reason: string | null; createdAt: string }
interface History { customerId: string; storeCredit: HistoryRow[]; loyalty: HistoryRow[] }
interface AdjustmentRequest { type: "store-credit" | "loyalty"; amountDelta: number; reason: string; idempotencyKey: string }
function money(minor: number): string { return formatMoneyMinor(minor); }

export default function CustomerStoredValuePage({ params }: { params: Promise<{ id: string }> }): JSX.Element {
  const { id } = use(params);
  const [type, setType] = useState<"store-credit" | "loyalty">("store-credit");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvalRequest, setApprovalRequest] = useState<AdjustmentRequest | null>(null);
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const customer = useQuery({ queryKey: ["customer", id], queryFn: () => apiFetch<Customer>(`/api/v1/customers/${id}`), retry: false });
  const canReviewHistory = ["owner", "manager"].includes(me.data?.role ?? "") &&
    (me.data?.permissions ?? []).includes("stored_value.adjust");
  const history = useQuery({ queryKey: ["customer-value-history", id], queryFn: () => apiFetch<History>(`/api/v1/customers/${id}/stored-value/history`), enabled: canReviewHistory, retry: false });
  const balance = useQuery({ queryKey: ["customer-value-balance", id], queryFn: () => apiFetch<{ storeCreditMinor: number; loyaltyPoints: number }>(`/api/v1/customers/${id}/stored-value`), retry: false });
  const storeCredit = history.data ? history.data.storeCredit.reduce((sum, row) => sum + (row.amountDeltaMinor ?? 0), 0) : (balance.data?.storeCreditMinor ?? 0);
  const loyalty = history.data ? history.data.loyalty.reduce((sum, row) => sum + (row.pointsDelta ?? 0), 0) : (balance.data?.loyaltyPoints ?? 0);
  const canAdjust = ["owner", "manager"].includes(me.data?.role ?? "");
  const canRequestApproval = me.data?.role === "cashier";

  async function applyAdjustment(request: AdjustmentRequest, approvalToken?: string): Promise<boolean> {
    setBusy(true); setError(""); setSuccess("");
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      const path = request.type === "loyalty" ? `/api/v1/customers/${id}/loyalty/adjust` : `/api/v1/customers/${id}/store-credit/adjust`;
      await apiFetch(path, { csrfToken: csrf.csrfToken, init: { method: "POST", headers: { "Idempotency-Key": request.idempotencyKey }, body: JSON.stringify({ amountMinor: request.amountDelta, reason: request.reason, ...(approvalToken ? { approvalToken } : {}) }) } });
      setAmount(""); setReason(""); setApprovalRequest(null); setApprovalOpen(false);
      setSuccess(`${request.type === "loyalty" ? "Loyalty" : "Store-credit"} balance adjusted.`);
      if (canReviewHistory) await history.refetch();
      else await balance.refetch();
      return true;
    } catch (cause) { setError(cause instanceof ApiError ? `${cause.code}: ${cause.message}` : "Adjustment failed."); return false; } finally { setBusy(false); }
  }

  function beginAdjustment(): void {
    const delta = Number(amount);
    if (!Number.isInteger(delta) || delta === 0 || reason.trim().length < 3) { setError(type === "loyalty" ? "Enter a non-zero whole-point adjustment and a reason." : "Enter a non-zero amount in minor units and a reason."); return; }
    const request = { type, amountDelta: delta, reason: reason.trim(), idempotencyKey: crypto.randomUUID() };
    if (canRequestApproval) { setError(""); setApprovalRequest(request); setApprovalOpen(true); return; }
    void applyAdjustment(request);
  }

  async function applyApprovedAdjustment(grant: ManagerApprovalGrant): Promise<boolean> {
    if (!approvalRequest) { setError("The pending adjustment details are unavailable. Reopen the request before continuing."); return true; }
    await applyAdjustment(approvalRequest, grant.token);
    // The grant is one-use even if the adjustment request fails; close the
    // approval dialog and let the cashier review the visible error before retrying.
    return true;
  }

  return <AppShell businessName={me.data?.businessName} role={me.data?.role}><main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6"><PageHeader eyebrow="Customers / Stored value" title={`${customer.data?.name ?? "Customer"} value ledger`} description="Review customer-level credit and loyalty activity. Every manual change requires a reason and is recorded for audit." actions={<Link href={`/customers/${id}`} className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">← Customer profile</Link>} />{success ? <Panel className="border-[#cfe9dc] bg-[#eaf7f0] p-4"><p role="status" className="text-sm font-medium text-[#1f8a5b]">{success}</p></Panel> : null}{error ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-4"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{error}</p></Panel> : null}<section className="grid gap-4 sm:grid-cols-2"><MetricCard label="Store credit" value={`₱${money(storeCredit)}`} icon="₱" tone="info" meta="Current ledger balance" /><MetricCard label="Loyalty points" value={loyalty.toLocaleString("en-PH")} icon="✦" tone="success" meta="Current points balance" /></section>{(canAdjust || canRequestApproval) ? <Panel className="p-5"><SectionHeader title="Manual adjustment" description={canRequestApproval ? "A manager must authorize this exact value change before it is applied." : "A negative change cannot exceed the current balance."} /><div className="mt-4 grid gap-3 sm:grid-cols-[180px_180px_1fr_auto]"><label className="text-[11px] font-semibold text-[#655b53]">Value type<select value={type} onChange={(event) => setType(event.target.value as typeof type)} className="field mt-1.5"><option value="store-credit">Store credit</option><option value="loyalty">Loyalty points</option></select></label><label className="text-[11px] font-semibold text-[#655b53]">{type === "loyalty" ? "Points delta" : "Amount delta (minor)"}<input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" className="field mt-1.5" placeholder={type === "loyalty" ? "100" : "5000"} /></label><label className="text-[11px] font-semibold text-[#655b53]">Reason<input value={reason} onChange={(event) => setReason(event.target.value)} className="field mt-1.5" placeholder="Customer service correction" /></label><PrimaryButton type="button" onClick={beginAdjustment} disabled={busy} className="self-end">{busy ? "Saving…" : canRequestApproval ? "Request manager review" : "Apply"}</PrimaryButton></div></Panel> : <Panel className="bg-[#fff4df] p-4 text-[11px] font-medium text-[#8a5606]">Manual value adjustments are restricted to owner and manager roles. Refunds and approved manager overrides remain available through their normal workflows.</Panel>}{canReviewHistory ? <><DataTableFrame><div className="px-5 py-4"><SectionHeader title="Store-credit history" description="Append-only entries, newest activity first." /></div><table className="premium-table min-w-[720px] text-left text-[12px]"><thead><tr><th className="px-5 pb-3">Date</th><th className="px-5 pb-3">Type</th><th className="px-5 pb-3">Reason</th><th className="px-5 pb-3 text-right">Change</th></tr></thead><tbody>{(history.data?.storeCredit ?? []).slice().reverse().map((row) => <tr key={row.id}><td className="font-data px-5 py-3 text-[#73685f]">{new Date(row.createdAt).toLocaleString("en-PH")}</td><td className="px-5 py-3"><StatusPill tone={(row.amountDeltaMinor ?? 0) < 0 ? "warn" : "ok"}>{row.type}</StatusPill></td><td className="px-5 py-3 text-[#73685f]">{row.reason ?? "—"}</td><td className="font-data px-5 py-3 text-right font-semibold">{(row.amountDeltaMinor ?? 0) > 0 ? "+" : ""}₱{money(row.amountDeltaMinor ?? 0)}</td></tr>)}</tbody></table></DataTableFrame><DataTableFrame><div className="px-5 py-4"><SectionHeader title="Loyalty history" description="Points earned, redeemed, refunded, or manually adjusted." /></div><table className="premium-table min-w-[720px] text-left text-[12px]"><thead><tr><th className="px-5 pb-3">Date</th><th className="px-5 pb-3">Type</th><th className="px-5 pb-3">Reason</th><th className="px-5 pb-3 text-right">Points</th></tr></thead><tbody>{(history.data?.loyalty ?? []).slice().reverse().map((row) => <tr key={row.id}><td className="font-data px-5 py-3 text-[#73685f]">{new Date(row.createdAt).toLocaleString("en-PH")}</td><td className="px-5 py-3"><StatusPill tone={(row.pointsDelta ?? 0) < 0 ? "warn" : "ok"}>{row.type}</StatusPill></td><td className="px-5 py-3 text-[#73685f]">{row.reason ?? "—"}</td><td className="font-data px-5 py-3 text-right font-semibold">{(row.pointsDelta ?? 0) > 0 ? "+" : ""}{row.pointsDelta ?? 0}</td></tr>)}</tbody></table></DataTableFrame></> : <Panel className="p-4 text-sm text-[#655b53]">Detailed value history is limited to owner and manager roles. Checkout balances remain available.</Panel>}<ManagerApprovalDialog open={approvalOpen} permission={approvalRequest?.type === "loyalty" ? "loyalty.adjust" : "stored_value.adjust"} action={{ kind: "value_adjustment", valueType: approvalRequest?.type === "loyalty" ? "loyalty" : "store_credit", targetId: id, amountDelta: approvalRequest?.amountDelta ?? 1, reason: approvalRequest?.reason ?? "Pending customer value adjustment" }} queueEnabled={canRequestApproval} title="Manager approval · customer value adjustment" description="An authorized manager must approve this exact customer value change. Approval is one-use and does not change the ledger until the request resumes." summary={approvalRequest ? `${approvalRequest.type === "loyalty" ? "Loyalty points" : "Store credit"} · ${approvalRequest.amountDelta} · ${approvalRequest.reason}` : undefined} onApproved={applyApprovedAdjustment} onClose={() => { setApprovalOpen(false); setApprovalRequest(null); }} /></main></AppShell>;
}
