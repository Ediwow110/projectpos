"use client";

import type { JSX } from "react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { AppShell } from "../../components/AppShell";
import { AtlasApprovalInbox } from "../../components/AtlasApprovalInbox";
import { AtlasCaseHistory, AtlasOwnerEscalation } from "../../components/AtlasCaseHistory";
import { PageHeader, Panel } from "../../components/premium";
import { PrimaryButton, StatusPill } from "../../components/ui";
import { ApiError, apiFetch } from "../../lib/api";
import { formatMoneyMinor } from "../../lib/money";

interface Concern {
  id: string; saleId: string; receiptNo: string; branchId: string | null; registerId: string | null;
  requesterName?: string; branchName?: string | null; registerName?: string | null;
  requesterId: string; reason: string; outcome: string; note: string | null;
  items: Array<{ saleItemId: string; name: string; qty: number; amountMinor: number }>;
  requestedRefundMinor: number; status: string; reviewReason: string | null; createdAt: string;
}
interface Me { role: string; permissions: string[]; businessName?: string; activeBranchId?: string | null; }
interface ManagerApprovalRequest {
  id: string; requesterId: string; branchId: string | null; registerId: string | null; kind: string;
  requesterName?: string | null; branchName?: string | null; registerName?: string | null;
  permission: string;
  action:
    | { kind: "discount"; lines: Array<{ productId: string; qty: number; lineDiscountMinor: number }>; orderDiscountMinor: number }
    | { kind: "shift_close"; shiftId: string; countedCashMinor: number; closeNotes?: string }
    | { kind: "refund"; saleId: string; items: Array<{ saleItemId: string; qty: number }>; loadRefunds?: Array<{ loadId: string; amountMinor: number }>; deliveryRefundMinor?: number; reason?: string }
    | { kind: "sale_void"; saleId: string; reason: string }
    | { kind: "inventory_movement"; productId: string; movementType: string; qtyDelta: number; reason?: string; branchId?: string }
    | { kind: "inventory_count"; countId: string }
    | { kind: "value_adjustment"; valueType: "gift_card" | "store_credit" | "loyalty"; targetId: string; amountDelta: number; reason: string };
  context?: { expectedCashMinor?: number; countedCashMinor?: number; varianceMinor?: number; saleReceiptNo?: string; saleStatus?: string; amountMinor?: number; lineItems?: Array<{ name: string; qty: number; amountMinor: number }>; discountLines?: Array<{ name: string; qty: number; lineDiscountMinor: number }>; productName?: string; movementType?: string; qtyDelta?: number; reason?: string | null; countNumber?: string; countStatus?: string; varianceLines?: Array<{ name: string; expectedQty: number; countedQty: number; varianceQty: number }>; valueType?: string; targetLabel?: string; amountDelta?: number } | null;
  status: string; decisionReason: string | null; createdAt: string;
}

const money = (minor: number) => `₱${formatMoneyMinor(minor)}`;
const tone = (status: string): "ok" | "warn" | "bad" | "info" => status === "APPROVED" ? "ok" : status === "REJECTED" ? "bad" : status === "OWNER_REVIEW" || status === "PENDING" ? "warn" : "info";

function ManagerApprovalCard({ row, credentials, note, busy, error, onCredentials, onNote, onDecision }: {
  row: ManagerApprovalRequest;
  credentials: { email: string; password: string; pin: string };
  note: string;
  busy: boolean;
  error: string | null;
  onCredentials: (value: { email: string; password: string; pin: string }) => void;
  onNote: (value: string) => void;
  onDecision: (value: "APPROVED" | "REJECTED") => void;
}): JSX.Element {
  const action = row.action;
  const valueAmount = action.kind === "value_adjustment"
    ? `${action.amountDelta > 0 ? "+" : ""}${action.valueType === "loyalty" ? `${Math.abs(action.amountDelta)} points` : money(action.amountDelta)}`
    : "";
  const detailTitle = action.kind === "discount"
    ? `${money(action.orderDiscountMinor + action.lines.reduce((sum, line) => sum + line.lineDiscountMinor, 0))} · ${action.lines.length} item lines`
    : action.kind === "shift_close" ? `Shift ${action.shiftId.slice(0, 8)} · counted ${money(action.countedCashMinor)}`
      : action.kind === "refund" ? `Receipt ${row.context?.saleReceiptNo ?? action.saleId.slice(0, 8)} · refund ${money(row.context?.amountMinor ?? 0)}`
        : action.kind === "sale_void" ? `Receipt ${row.context?.saleReceiptNo ?? action.saleId.slice(0, 8)} · void ${money(row.context?.amountMinor ?? 0)}`
          : action.kind === "inventory_movement" ? `${row.context?.productName ?? "Inventory item"} · ${action.qtyDelta > 0 ? "+" : ""}${action.qtyDelta}`
            : action.kind === "inventory_count" ? `${row.context?.countNumber ?? `Count ${action.countId.slice(0, 8)}`} · ${row.context?.varianceLines?.length ?? 0} variance lines`
              : `${action.valueType.replaceAll("_", " ")} · ${valueAmount}`;
  const kindLabel = action.kind === "discount" ? "Discount override" : action.kind === "shift_close" ? "Shift close variance" : action.kind === "refund" ? "Refund approval" : action.kind === "sale_void" ? "Sale void" : action.kind === "inventory_movement" ? "Inventory adjustment" : action.kind === "inventory_count" ? "Stock count" : `${action.valueType === "loyalty" ? "loyalty points" : action.valueType.replaceAll("_", " ")} adjustment`;
  return <article id={`manager-approval-${row.id}`} tabIndex={-1} className="scroll-mt-24 rounded-xl border border-[#e4e9e3] bg-[#fafbf9] p-4 focus-visible:outline-2 focus-visible:outline-[#da614c]">
    <div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-[#eff2ed] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.05em] text-[#53615a]">{kindLabel}</span><h3 className="min-w-0 flex-1 text-sm font-semibold text-[#202826]">{detailTitle}</h3><StatusPill tone={tone(row.status)}>{row.status.replaceAll("_", " ")}</StatusPill></div>
    <p className="mt-2 text-xs text-[var(--color-atlas-muted-strong)]">Requested by {row.requesterName ?? "Staff member"} · {row.branchName ?? "Unassigned branch"} · {row.registerName ?? "No register"} · {new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(row.createdAt))}</p>
    <section aria-label="Protected action review" className="mt-4 grid items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_230px]">
      <div className="rounded-xl border border-[#e5e9e3] bg-white p-4 sm:p-5">
        <h4 className="font-display text-lg font-semibold text-[#202826]">Review protected action</h4>
        <p className="mt-1 text-xs text-[var(--color-atlas-muted-strong)]">Verified request details, not a payment or inventory execution.</p>
        <dl className="mt-4 divide-y divide-[#e5e9e3] text-[13px]">
          {[
            { label: "Requested by", value: row.requesterName ?? "Staff member" },
            { label: "Protected action", value: kindLabel },
            { label: "Transaction / request", value: row.context?.saleReceiptNo ? `Receipt ${row.context.saleReceiptNo}` : detailTitle },
            { label: "Branch & register", value: `${row.branchName ?? "Unassigned branch"} / ${row.registerName ?? "No register"}` },
            { label: "Required permission", value: row.permission },
            ...(row.context?.saleStatus ? [{ label: "Original sale status", value: row.context.saleStatus }] : []),
            ...(action.kind === "refund" ? [{ label: "Requested refund", value: row.context?.amountMinor === undefined ? "Unavailable" : money(row.context.amountMinor) }] : []),
          ].map(({ label, value }) => (
            <div key={label} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[165px_minmax(0,1fr)]">
              <dt className="text-[var(--color-atlas-muted-strong)]">{label}</dt>
              <dd className="min-w-0 break-words font-semibold text-[#202826]">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <aside aria-label="Decision safeguards" className="rounded-xl border border-[#e5e9e3] bg-white p-4">
        <h4 className="font-display text-[17px] font-semibold text-[#202826]">Decision safeguards</h4>
        <ul className="mt-4 space-y-2.5 text-xs leading-5 text-[#202826]">
          {[
            "Business, branch and reviewer permissions are verified by the API.",
            "The protected action must still match the original request.",
            "Approval requires current manager or owner credentials.",
            "One-use approval does not itself execute a sale, refund or stock change.",
          ].map((rule) => <li key={rule} className="rounded-lg bg-[#f0f3ef] px-3 py-3">{rule}</li>)}
        </ul>
      </aside>
    </section>
    {action.kind === "discount" ? <div className="mt-3 space-y-1 text-xs text-[#53615a]">{action.lines.map((line, index) => <p key={`${line.productId}-${index}`}>{row.context?.discountLines?.[index]?.name ?? "Sale item"} × {line.qty} · discount {money(line.lineDiscountMinor)}</p>)}{action.orderDiscountMinor > 0 && <p>Sale discount · {money(action.orderDiscountMinor)}</p>}</div>
      : action.kind === "shift_close" ? <div className="mt-3 grid gap-2 rounded-lg border border-[#e4e9e3] bg-white p-3 text-xs text-[#53615a] sm:grid-cols-3"><p>Expected cash <strong className="font-data ml-1 text-[#202826]">{row.context?.expectedCashMinor === undefined ? "Unavailable" : money(row.context.expectedCashMinor)}</strong></p><p>Counted cash <strong className="font-data ml-1 text-[#202826]">{money(action.countedCashMinor)}</strong></p><p>Variance <strong className="font-data ml-1 text-[#202826]">{row.context?.varianceMinor === undefined ? "Unavailable" : money(row.context.varianceMinor)}</strong></p>{action.closeNotes && <p className="sm:col-span-3">Close notes: {action.closeNotes}</p>}</div>
        : action.kind === "refund" ? <div className="mt-3 space-y-1 rounded-lg border border-[#e4e9e3] bg-white p-3 text-xs text-[#53615a]"><p>Sale status: {row.context?.saleStatus ?? "Unavailable"}</p>{row.context?.lineItems?.map((line, index) => <p key={`${line.name}-${index}`}>{line.name} × {line.qty} · {money(line.amountMinor)}</p>)}{(action.loadRefunds?.length ?? 0) > 0 && <p>{action.loadRefunds!.length} gift-card load refund(s)</p>}{action.deliveryRefundMinor ? <p>Delivery refund · {money(action.deliveryRefundMinor)}</p> : null}{action.reason && <p>Reason · {action.reason}</p>}</div>
          : action.kind === "sale_void" ? <div className="mt-3 rounded-lg border border-[#e4e9e3] bg-white p-3 text-xs text-[#53615a]"><p>Sale status: {row.context?.saleStatus ?? "Unavailable"}</p><p>Reason · {action.reason}</p></div>
            : action.kind === "inventory_movement" ? <div className="mt-3 rounded-lg border border-[#e4e9e3] bg-white p-3 text-xs text-[#53615a]"><p>{row.context?.movementType ?? action.movementType} · quantity {action.qtyDelta > 0 ? "+" : ""}{action.qtyDelta}</p><p>Reason · {row.context?.reason ?? action.reason ?? "Not provided"}</p></div>
              : action.kind === "inventory_count" ? <div className="mt-3 space-y-1 rounded-lg border border-[#e4e9e3] bg-white p-3 text-xs text-[#53615a]"><p>Status · {row.context?.countStatus ?? "Unavailable"}</p>{row.context?.varianceLines?.map((line, index) => <p key={`${line.name}-${index}`}>{line.name} · expected {line.expectedQty}, counted {line.countedQty}, variance {line.varianceQty > 0 ? "+" : ""}{line.varianceQty}</p>)}</div>
                : <div className="mt-3 rounded-lg border border-[#e4e9e3] bg-white p-3 text-xs text-[#53615a]"><p>{row.context?.targetLabel ?? "Protected value account"} · {valueAmount}</p><p>Reason · {action.reason}</p></div>}
    {row.decisionReason && <p className="mt-3 text-xs text-[var(--color-atlas-muted-strong)]">Decision note: {row.decisionReason}</p>}
    {row.status === "PENDING" && <><div className="mt-4 grid gap-3 sm:grid-cols-3"><label className="text-[11px] font-semibold text-[var(--color-atlas-muted-strong)]">Your manager email<input type="email" autoComplete="username" value={credentials.email} onChange={(event) => onCredentials({ ...credentials, email: event.target.value })} className="field mt-1" /></label><label className="text-[11px] font-semibold text-[var(--color-atlas-muted-strong)]">Password<input type="password" autoComplete="current-password" value={credentials.password} onChange={(event) => onCredentials({ ...credentials, password: event.target.value, pin: "" })} className="field mt-1" /></label><label className="text-[11px] font-semibold text-[var(--color-atlas-muted-strong)]">Approval PIN (instead)<input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={credentials.pin} onChange={(event) => onCredentials({ ...credentials, pin: event.target.value.replace(/\D/g, "").slice(0, 6), password: "" })} className="field mt-1 font-data tracking-[0.25em]" /></label></div><label className="mt-3 block text-[11px] font-semibold text-[var(--color-atlas-muted-strong)]">Decision note<input maxLength={300} value={note} onChange={(event) => onNote(event.target.value)} className="field mt-1" placeholder="Optional note for approval, required for rejection" /></label><div className="mt-3 flex flex-wrap justify-end gap-2"><button type="button" disabled={busy || note.trim().length < 3} onClick={() => onDecision("REJECTED")} className="min-h-10 rounded-lg border border-[#e5c9c2] px-4 text-sm font-semibold text-[#a34132] disabled:opacity-50">Reject</button><PrimaryButton type="button" disabled={busy || !credentials.email.trim() || (!credentials.password && !/^\d{6}$/.test(credentials.pin))} onClick={() => onDecision("APPROVED")} className="min-h-10 rounded-lg bg-[#202826] shadow-none hover:bg-[#35423d]">{busy ? "Recording…" : `Authorize ${kindLabel.toLowerCase()}`}</PrimaryButton></div></>}
    {error && <p role="alert" className="mt-3 text-sm text-[#a34132]">{error}</p>}
  </article>;
}

export default function CustomerConcernsPage(): JSX.Element {
  const client = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const cases = useQuery({ queryKey: ["customer-concerns", me.data?.activeBranchId ?? "ALL"], queryFn: () => apiFetch<Concern[]>("/api/v1/customer-concerns"), retry: false, enabled: !me.isPending });
  const role = me.data?.role ?? "cashier";
  const approver = role === "manager" || role === "owner";
  const canReviewCases = me.data?.permissions.includes("customer_concern.review") ?? false;
  const approvalRequests = useQuery({ queryKey: ["manager-approval-requests", me.data?.activeBranchId ?? "ALL"], queryFn: () => apiFetch<{ requests: ManagerApprovalRequest[] }>("/api/v1/approvals/requests"), retry: false, enabled: approver && !me.isPending, refetchInterval: approver ? 5000 : false });
  const [decisionReason, setDecisionReason] = useState<Record<string, string>>({});
  const [ownerPassword, setOwnerPassword] = useState<Record<string, string>>({});
  const [approvalCredentials, setApprovalCredentials] = useState<Record<string, { email: string; password: string; pin: string }>>({});
  const [approvalNotes, setApprovalNotes] = useState<Record<string, string>>({});
  const [approvalStatusFilter, setApprovalStatusFilter] = useState("PENDING");
  const [approvalKindFilter, setApprovalKindFilter] = useState("ALL");
  const [approvalBranchFilter, setApprovalBranchFilter] = useState("ALL");
  const [approvalAgeFilter, setApprovalAgeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ACTION_REQUIRED");
  const [outcomeFilter, setOutcomeFilter] = useState("ALL");
  const [ageFilter, setAgeFilter] = useState("ALL");
  const decision = useMutation({
    mutationFn: async ({ id, value, reason, verifyOwnerPassword }: { id: string; value: "APPROVED" | "REJECTED"; reason: string; verifyOwnerPassword?: string }) => {
      const { csrfToken } = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      if (verifyOwnerPassword !== undefined) {
        await apiFetch("/api/v1/auth/confirm-password", {
          csrfToken,
          init: { method: "POST", body: JSON.stringify({ password: verifyOwnerPassword }) },
        });
      }
      return apiFetch<Concern>(`/api/v1/customer-concerns/${encodeURIComponent(id)}/decision`, {
        csrfToken, init: { method: "POST", body: JSON.stringify({ decision: value, reason }) },
      });
    },
    onSuccess: async () => { setOwnerPassword({}); await client.invalidateQueries({ queryKey: ["customer-concerns"] }); },
  });
  const approvalDecision = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: "APPROVED" | "REJECTED" }) => {
      const { csrfToken } = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      const credentials = approvalCredentials[id] ?? { email: "", password: "", pin: "" };
      const body = value === "APPROVED"
        ? { decision: value, email: credentials.email.trim(), ...(credentials.pin ? { pin: credentials.pin } : { password: credentials.password }) }
        : { decision: value, reason: approvalNotes[id] ?? "" };
      return apiFetch<{ request: ManagerApprovalRequest }>(`/api/v1/approvals/requests/${encodeURIComponent(id)}/decision`, {
        csrfToken, init: { method: "POST", body: JSON.stringify(body) },
      });
    },
    onSuccess: async () => {
      setApprovalCredentials({}); setApprovalNotes({});
      await client.invalidateQueries({ queryKey: ["manager-approval-requests"] });
    },
  });
  const rows = cases.data ?? [];
  const now = Date.now();
  const filteredApprovalRequests = (approvalRequests.data?.requests ?? []).filter((row) => {
    const statusMatches = approvalStatusFilter === "ALL" || row.status === approvalStatusFilter;
    const kindMatches = approvalKindFilter === "ALL" || row.action.kind === approvalKindFilter;
    const branchMatches = approvalBranchFilter === "ALL" || (approvalBranchFilter === "UNASSIGNED" ? row.branchId === null : row.branchId === approvalBranchFilter);
    const ageMs = now - new Date(row.createdAt).getTime();
    const ageMatches = approvalAgeFilter === "ALL" || (approvalAgeFilter === "24H" ? ageMs <= 86_400_000 : approvalAgeFilter === "7D" ? ageMs <= 604_800_000 : ageMs <= 2_592_000_000);
    return statusMatches && kindMatches && branchMatches && ageMatches;
  });
  const visibleRows = rows.filter((row) => {
    const statusMatches = !canReviewCases || statusFilter === "ALL" ||
      (statusFilter === "ACTION_REQUIRED" ? row.status === "PENDING" || row.status === "OWNER_REVIEW" :
        statusFilter === "CLOSED" ? row.status === "REJECTED" || row.status === "REFUND_EXECUTED" || row.status === "RESOLVED" : row.status === statusFilter);
    const outcomeMatches = outcomeFilter === "ALL" || row.outcome === outcomeFilter;
    const ageMs = now - new Date(row.createdAt).getTime();
    const ageMatches = ageFilter === "ALL" || (ageFilter === "24H" ? ageMs <= 86_400_000 : ageFilter === "7D" ? ageMs <= 604_800_000 : ageMs <= 2_592_000_000);
    return statusMatches && outcomeMatches && ageMatches;
  });

  return <AppShell businessName={me.data?.businessName} role={role} atlasApprovals={approver} atlasCashier={!approver}>
    <main className={approver ? "mx-auto w-full max-w-none space-y-6 px-4 pb-32 pt-8 sm:px-8 sm:pb-12 lg:px-[40px]" : "mx-auto max-w-[1120px] space-y-5 px-4 pb-10 pt-3 sm:px-6"}>
      {approver ? <><header className="space-y-2">
        <p className="hidden font-data text-[11px] tracking-[0.05em] text-[var(--color-atlas-accent-strong)] sm:block">APPROVAL OPERATIONS / ATLAS 2026</p>
        <h1 className="font-display text-[25px] font-semibold text-[#202826] sm:text-[29px]"><span className="sm:hidden">Approval requests</span><span className="hidden sm:inline">{role === "owner" ? "Approval inbox" : "Manager approval inbox"}</span></h1>
        <p className="hidden text-[13px] text-[var(--color-atlas-muted-strong)] sm:block">Requests and review actions are limited by your permissions and branch access.</p>
      </header>{role === "owner" && !cases.isPending && !cases.isError ? <AtlasOwnerEscalation rows={rows} /> : null}<AtlasApprovalInbox rows={filteredApprovalRequests} loading={approvalRequests.isPending} failed={approvalRequests.isError} onRetry={() => void approvalRequests.refetch()} /></> : null}
      {!approver ? <PageHeader eyebrow="Sales / Customer cases" title={canReviewCases ? "Customer case inbox" : "Customer case history"}
        description={canReviewCases ? "Review product concerns and record an authorized decision. Approval records authorization only; it does not execute a refund or exchange." : "Track submitted product concerns and manager decisions."} /> : null}
      {approver ? <div id="manager-approval-details" className="scroll-mt-24" /> : null}
      {approver && <Panel className="!rounded-[12px] !border-[#e4e9e3] p-4 sm:p-5"><div className="flex flex-wrap items-center gap-2"><h2 className="flex-1 font-display text-base font-semibold text-[#202826]">Manager approvals</h2><span className="rounded-md bg-[#f9eed8] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#846124]">{approvalRequests.data?.requests.filter((row) => row.status === "PENDING").length ?? 0} pending</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><label className="text-[10px] font-semibold text-[var(--color-atlas-muted-strong)]">Status<select aria-label="Approval status" value={approvalStatusFilter} onChange={(event) => setApprovalStatusFilter(event.target.value)} className="field mt-1"><option value="PENDING">Pending</option><option value="ALL">All statuses</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="EXPIRED">Expired</option></select></label><label className="text-[10px] font-semibold text-[var(--color-atlas-muted-strong)]">Action type<select aria-label="Approval action type" value={approvalKindFilter} onChange={(event) => setApprovalKindFilter(event.target.value)} className="field mt-1"><option value="ALL">All actions</option><option value="discount">Discount</option><option value="shift_close">Cash variance</option><option value="refund">Refund</option><option value="sale_void">Sale void</option><option value="inventory_movement">Inventory adjustment</option><option value="inventory_count">Stock count</option><option value="value_adjustment">Stored value / loyalty</option></select></label><label className="text-[10px] font-semibold text-[var(--color-atlas-muted-strong)]">Branch<select aria-label="Approval branch" value={approvalBranchFilter} onChange={(event) => setApprovalBranchFilter(event.target.value)} className="field mt-1"><option value="ALL">All visible branches</option><option value="UNASSIGNED">Unassigned branch</option>{[...new Map((approvalRequests.data?.requests ?? []).filter((row) => row.branchId).map((row) => [row.branchId!, row.branchName ?? "Branch"])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label className="text-[10px] font-semibold text-[var(--color-atlas-muted-strong)]">Submitted<select aria-label="Approval age" value={approvalAgeFilter} onChange={(event) => setApprovalAgeFilter(event.target.value)} className="field mt-1"><option value="ALL">Any time</option><option value="24H">Last 24 hours</option><option value="7D">Last 7 days</option><option value="30D">Last 30 days</option></select></label></div>{approvalRequests.isPending ? <p className="mt-3 text-sm text-[var(--color-atlas-muted-strong)]">Loading approval requests…</p> : approvalRequests.isError ? <p role="alert" className="mt-3 text-sm text-[#a34132]">Approval requests could not be loaded. Refresh the page and try again.</p> : filteredApprovalRequests.length === 0 ? <p className="mt-3 text-sm text-[var(--color-atlas-muted-strong)]">No approvals match the selected filters.</p> : <div className="mt-4 space-y-3" aria-live="polite">{filteredApprovalRequests.map((row) => { const credentials = approvalCredentials[row.id] ?? { email: "", password: "", pin: "" }; const error = approvalDecision.isError ? approvalDecision.error instanceof ApiError && approvalDecision.error.code === "AUTH_INVALID_CREDENTIALS" ? "Your manager credentials could not be verified. The request remains pending." : "Decision failed; the request remains unchanged." : null; return <ManagerApprovalCard key={row.id} row={row} credentials={credentials} note={approvalNotes[row.id] ?? ""} busy={approvalDecision.isPending} error={error} onCredentials={(value) => setApprovalCredentials((prev) => ({ ...prev, [row.id]: value }))} onNote={(value) => setApprovalNotes((prev) => ({ ...prev, [row.id]: value }))} onDecision={(value) => approvalDecision.mutate({ id: row.id, value })} />; })}</div>}</Panel>}
      {approver && <Panel className="!rounded-[12px] !border-[#e4e9e3] bg-[#fafbf9] p-4 text-xs leading-5 text-[#53615a]">Every queued approval authorizes one exact retry of the protected action. Approval itself does not execute financial, inventory, stored-value, or loyalty changes.</Panel>}
      {approver && <Panel className="!rounded-[12px] !border-[#e4e9e3] p-4"><h2 className="font-display text-sm font-semibold text-[#202826]">Protected actions</h2><p className="mt-1 text-xs leading-5 text-[var(--color-atlas-muted-strong)]">Inventory movements and stock counts are available in this inbox. Store-credit and loyalty adjustments can be requested from a customer value ledger; gift-card adjustments remain in their point-of-use flow.</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><Link href="/inventory" className="rounded-lg border border-[#e4e9e3] p-3 text-sm font-semibold text-[#202826] hover:border-[#9baa9d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267552]">Inventory adjustments · Open inventory</Link><Link href="/shifts" className="rounded-lg border border-[#e4e9e3] p-3 text-sm font-semibold text-[#202826] hover:border-[#9baa9d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267552]">Shift detail · Open shifts</Link></div></Panel>}
      {approver && <Panel className="!rounded-[12px] !border-[#e4e9e3] p-4"><div className="grid gap-3 sm:grid-cols-3"><label className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-atlas-muted-strong)]">Status<select aria-label="Case status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#dce3dc] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#202826] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267552]"><option value="ACTION_REQUIRED">Needs review</option><option value="ALL">All statuses</option><option value="APPROVED">Authorized</option><option value="CLOSED">Closed</option></select></label><label className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-atlas-muted-strong)]">Action type<select aria-label="Case type" value={outcomeFilter} onChange={(event) => setOutcomeFilter(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#dce3dc] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#202826] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267552]"><option value="ALL">All actions</option><option value="REFUND">Refund</option><option value="EXCHANGE">Exchange</option></select></label><label className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-atlas-muted-strong)]">Submitted<select aria-label="Case age" value={ageFilter} onChange={(event) => setAgeFilter(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#dce3dc] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#202826] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267552]"><option value="ALL">Any time</option><option value="24H">Last 24 hours</option><option value="7D">Last 7 days</option><option value="30D">Last 30 days</option></select></label></div><p className="mt-3 text-[10px] text-[var(--color-atlas-muted-strong)]">Branch scope follows the active branch selected in the workspace header.</p></Panel>}
      {approver ? <AtlasCaseHistory rows={rows} loading={cases.isPending} failed={cases.isError} canReview={canReviewCases} /> : null}
      {approver ? <div id="customer-case-decisions" className="scroll-mt-24" aria-hidden="true" /> : null}
      {cases.isPending ? <Panel className="p-6 text-sm text-[var(--color-atlas-muted-strong)]">Loading customer cases…</Panel> : cases.isError ? <Panel className="p-6"><h2 className="font-semibold text-[#202826]">Cases could not be loaded</h2><p role="alert" className="mt-2 text-sm text-[var(--color-atlas-muted-strong)]">{cases.error instanceof ApiError && cases.error.code === "FORBIDDEN" ? "Your current access does not include customer case history." : "Check the connection and try again."}</p><button type="button" onClick={() => void cases.refetch()} className="mt-4 min-h-10 rounded-lg border border-[#dce3dc] px-4 text-sm font-semibold">Retry</button></Panel> : rows.length === 0 ? <Panel className="grid min-h-[250px] place-items-center p-8 text-center"><div><span aria-hidden className="text-3xl text-[#267552]">↩</span><h2 className="mt-3 font-display text-lg font-semibold text-[#202826]">No customer cases yet</h2><p className="mt-2 text-sm text-[var(--color-atlas-muted-strong)]">Verified receipt lookups can start a case when a purchased item needs follow-up.</p></div></Panel> : <section aria-label={canReviewCases ? "Customer case results" : "Customer case history"} className="space-y-3" aria-live="polite">
        {visibleRows.length === 0 ? <Panel className="p-6 text-sm text-[var(--color-atlas-muted-strong)]">No cases match these filters.</Panel> : visibleRows.map((row) => {
          const canReview = canReviewCases && (row.status === "PENDING" || (role === "owner" && row.status === "OWNER_REVIEW"));
          const needsOwnerVerification = role === "owner" && row.status === "OWNER_REVIEW";
          const ownerPasswordValue = ownerPassword[row.id] ?? "";
          return <Panel key={row.id} className="!rounded-[14px] !border-[#e4e9e3] p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-[#eff2ed] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#53615a]">{row.outcome}</span><h2 className="min-w-0 flex-1 font-display text-base font-semibold text-[#202826]">Receipt {row.receiptNo}</h2><StatusPill tone={tone(row.status)}>{row.status.replaceAll("_", " ")}</StatusPill></div>
            <p className="mt-2 text-xs text-[var(--color-atlas-muted-strong)]">Submitted by {row.requesterName ?? "Staff member"} · {row.branchName ?? "Unassigned branch"}{row.registerName ? ` · ${row.registerName}` : ""} · {new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(row.createdAt))}</p>
            <p className="mt-1 text-xs text-[var(--color-atlas-muted-strong)]">{row.reason.replaceAll("_", " ")}</p>
            <div className="mt-4 divide-y divide-[#eef0ec]">{row.items.map((item) => <div key={item.saleItemId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span className="text-[#202826]">{item.name} <span className="text-[var(--color-atlas-muted-strong)]">× {item.qty}</span></span><span className="font-data text-[#202826]">{money(item.amountMinor)}</span></div>)}</div>
            {row.note && <p className="mt-3 rounded-lg bg-[#fafbf9] p-3 text-sm text-[#53615a]">{row.note}</p>}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[#e4e9e3] pt-3"><span className="text-xs text-[var(--color-atlas-muted-strong)]">Requested amount</span><strong className="font-data text-[#202826]">{money(row.requestedRefundMinor)}</strong></div>
            {row.status === "APPROVED" && <p className="mt-3 rounded-lg bg-[#eef5f0] p-3 text-xs leading-5 text-[#52685b]">Authorized for follow-up. No funds or inventory were changed by this approval. Process any refund or exchange through its existing protected workflow.</p>}
            {row.status === "APPROVED" && row.outcome === "REFUND" && <Link href={`/sales/${encodeURIComponent(row.saleId)}?concernId=${encodeURIComponent(row.id)}`} className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-[#202826] px-4 text-sm font-semibold text-white hover:bg-[#35423d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267552]">Process approved refund</Link>}
            {row.status === "APPROVED" && row.outcome === "EXCHANGE" && (role === "owner" || role === "manager") && <Link href={`/sales/${encodeURIComponent(row.saleId)}?concernId=${encodeURIComponent(row.id)}`} className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-[#202826] px-4 text-sm font-semibold text-white hover:bg-[#35423d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267552]">Open approved exchange</Link>}
            {row.status === "OWNER_REVIEW" && role !== "owner" && <p className="mt-3 rounded-lg bg-[#fff7e8] p-3 text-xs text-[#775d2c]">This amount requires an owner decision. It is not actionable for your role.</p>}
            {row.reviewReason && <p className="mt-3 text-xs text-[var(--color-atlas-muted-strong)]">Review note: {row.reviewReason}</p>}
            {canReview && <div className="mt-4 grid gap-3 border-t border-[#e4e9e3] pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] sm:items-end"><div><label htmlFor={`review-${row.id}`} className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-atlas-muted-strong)]">Decision note</label><input id={`review-${row.id}`} value={decisionReason[row.id] ?? ""} onChange={(event) => setDecisionReason((prev) => ({ ...prev, [row.id]: event.target.value }))} maxLength={300} className="mt-1 min-h-10 w-full rounded-lg border border-[#dce3dc] px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267552]" placeholder="Reason for your decision" /></div>{needsOwnerVerification && <div><label htmlFor={`owner-password-${row.id}`} className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-atlas-muted-strong)]">Confirm owner password</label><input id={`owner-password-${row.id}`} type="password" autoComplete="current-password" value={ownerPasswordValue} onChange={(event) => setOwnerPassword((prev) => ({ ...prev, [row.id]: event.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-[#dce3dc] px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267552]" /></div>}<button type="button" disabled={decision.isPending || (decisionReason[row.id] ?? "").trim().length < 3 || (needsOwnerVerification && !ownerPasswordValue.trim())} onClick={() => decision.mutate({ id: row.id, value: "REJECTED", reason: decisionReason[row.id] ?? "", ...(needsOwnerVerification ? { verifyOwnerPassword: ownerPasswordValue } : {}) })} className="min-h-10 rounded-lg border border-[#e5c9c2] px-4 text-sm font-semibold text-[#a34132] disabled:opacity-50">{needsOwnerVerification ? "Verify owner & reject" : "Reject"}</button><PrimaryButton type="button" disabled={decision.isPending || (decisionReason[row.id] ?? "").trim().length < 3 || (needsOwnerVerification && !ownerPasswordValue.trim())} onClick={() => decision.mutate({ id: row.id, value: "APPROVED", reason: decisionReason[row.id] ?? "", ...(needsOwnerVerification ? { verifyOwnerPassword: ownerPasswordValue } : {}) })} className="min-h-10 rounded-lg bg-[#202826] shadow-none hover:bg-[#35423d]">{needsOwnerVerification ? "Verify owner & authorize" : "Authorize request"}</PrimaryButton></div>}
          </Panel>;
        })}
      </section>}
      {decision.isError && <p role="alert" className="text-sm text-[#a34132]">{decision.error instanceof ApiError && decision.error.code === "AUTH_INVALID_CREDENTIALS" ? "Owner password could not be verified. The case remains unchanged." : decision.error instanceof ApiError && decision.error.code === "AUTH_REAUTH_REQUIRED" ? "Verify your password before deciding this owner escalation. The case remains unchanged." : "Decision failed. The case remains unchanged; refresh and try again."}</p>}
      <p className="text-[11px] leading-5 text-[var(--color-atlas-muted-strong)]">Customer concern approval records a decision only. Refund execution, tender reconciliation, and stock restocking remain within existing workflows.</p>
    </main>
  </AppShell>;
}
