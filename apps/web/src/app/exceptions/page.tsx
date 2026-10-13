"use client";

import type { JSX, ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../../components/AppShell";
import { PageHeader, Panel } from "../../components/premium";
import { StatusPill } from "../../components/ui";
import { ApiError, apiFetch } from "../../lib/api";
import { formatMoneyMinor } from "../../lib/money";

interface Me { userId: string; businessId: string; role: string; activeBranchId: string | null; businessName?: string; activeBranchName?: string | null; }
interface Sale { id: string; receiptNo: string; status: string; totalMinor: number; createdAt: string; }
interface SalesPage { items: Sale[]; }
interface CountLine { productNameSnapshot: string; varianceQty: number | null; }
interface Count { id: string; name: string; createdAt: string; lines: CountLine[]; }
interface CountPage { items: Count[]; }
interface HeldSale { heldId: string; sale: { id: string; createdAt: string; registerId: string | null; }; }
interface HeldPage { items: HeldSale[]; }
interface WebOrder { id: string; status: string; createdAt: string; submittedAt?: string | null; shortCode?: string | null; }
interface OrderPage { items: WebOrder[]; }

const money = (minor: number) => `₱${formatMoneyMinor(minor)}`;
const formatDate = (value: string) => new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila",
}).format(new Date(value));
const olderThan40Minutes = (value: string) => Date.now() - new Date(value).getTime() >= 40 * 60_000;

function ExceptionRow({ index, title, detail, priority, owner, href }: {
  index: number; title: string; detail: string; priority: "HIGH" | "MEDIUM" | "LOW";
  owner: string; href: string;
}): JSX.Element {
  return <article className="grid gap-3 rounded-[10px] bg-[#fafbf9] p-4 sm:grid-cols-[42px_minmax(0,1fr)_104px_150px] sm:items-center">
    <span aria-hidden className={`grid h-[42px] w-[42px] place-items-center rounded-[9px] text-sm font-semibold ${priority === "HIGH" ? "bg-[#fff1ef] text-[#b74945]" : "bg-[#f0f3ef] text-[#53615a]"}`}>{String(index).padStart(2, "0")}</span>
    <div className="min-w-0">
      <h3 className="text-sm font-semibold text-[#202826]">{title}</h3>
      <p className="mt-1 break-words text-xs text-[#748078]">{detail}</p>
      <Link href={href} aria-label={`Review record: ${title}`} className="mt-2 inline-flex min-h-8 items-center text-xs font-semibold text-[#267552] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267552]">Review record<span className="sr-only">: {title}</span></Link>
    </div>
    <StatusPill tone={priority === "HIGH" ? "bad" : priority === "MEDIUM" ? "warn" : "info"}>{priority}</StatusPill>
    <span className="rounded-md bg-[#f0f3ef] px-3 py-2 text-xs font-semibold text-[#748078]">{owner}</span>
  </article>;
}

function CategoryState({ pending, error, empty, children }: {
  pending: boolean; error: unknown; empty: boolean; children: ReactNode;
}): JSX.Element | null {
  if (pending) return <p className="px-1 py-3 text-sm text-[#748078]">Checking current records…</p>;
  if (error) return <p role="alert" className="px-1 py-3 text-sm text-[#8c4337]">This category could not be checked with your current access. Open its workflow to review it directly.</p>;
  if (empty) return null;
  return <>{children}</>;
}

export default function OperationalExceptionsPage(): JSX.Element {
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const canReview = me.data?.role === "manager" || me.data?.role === "owner";
  const exceptionScope = [me.data?.businessId ?? "", me.data?.userId ?? "", me.data?.activeBranchId ?? "ALL"] as const;
  const sales = useQuery({
    queryKey: ["operational-exceptions", ...exceptionScope, "unknown-payments"],
    queryFn: () => apiFetch<SalesPage>("/api/v1/sales?status=PAYMENT_UNKNOWN&limit=100"),
    retry: false, enabled: canReview, refetchInterval: 30_000,
  });
  const counts = useQuery({
    queryKey: ["operational-exceptions", ...exceptionScope, "submitted-counts"],
    queryFn: () => apiFetch<CountPage>("/api/v1/inventory/counts?status=SUBMITTED&page=1&pageSize=100"),
    retry: false, enabled: canReview, refetchInterval: 30_000,
  });
  const held = useQuery({
    queryKey: ["operational-exceptions", ...exceptionScope, "held-sales"],
    queryFn: () => apiFetch<HeldPage>("/api/v1/sales/held"),
    retry: false, enabled: canReview, refetchInterval: 30_000,
  });
  const orders = useQuery({
    queryKey: ["operational-exceptions", ...exceptionScope, "web-orders"],
    queryFn: () => apiFetch<OrderPage>("/api/v1/orders?channel=WEB&limit=100"),
    retry: false, enabled: canReview, refetchInterval: 30_000,
  });

  const unknownPayments = (sales.data?.items ?? []).filter((row) => row.status === "PAYMENT_UNKNOWN");
  const countVariances = (counts.data?.items ?? []).filter((row) => row.lines.some((line) => line.varianceQty !== null && line.varianceQty !== 0));
  // Held-sale records are deliberately sourced from the current actor's API view;
  // this page does not broaden the endpoint's actor boundary for managers.
  const staleHeld = (held.data?.items ?? []).filter((row) => olderThan40Minutes(row.sale.createdAt));
  const delayedOrders = (orders.data?.items ?? []).filter((row) =>
    !["COMPLETED", "REJECTED", "CANCELLED", "EXPIRED"].includes(row.status)
      && olderThan40Minutes(row.submittedAt ?? row.createdAt));
  const exceptionCount = unknownPayments.length + countVariances.length + staleHeld.length + delayedOrders.length;
  const role = me.data?.role ?? "";

  return <AppShell role={role} businessName={me.data?.businessName}>
    <main className="mx-auto w-full max-w-[1480px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader eyebrow="APPROVAL OPERATIONS / ATLAS 2026" title="Operational exception center" description="Review by urgency and ownership. Exceptions link to their existing protected workflows; this page does not change payment, stock, or order state." />
      {!me.isPending && !canReview ? <Panel className="p-6"><h2 className="font-semibold text-[#202826]">Manager access required</h2><p className="mt-2 text-sm text-[#748078]">Operational exceptions are available to managers and owners.</p></Panel> :
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_270px]">
          <Panel className="space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-2 pb-2"><div><h2 className="font-display text-xl font-semibold text-[#202826]">Review by urgency and ownership</h2><p className="mt-1 text-xs text-[#748078]">{me.data?.activeBranchName ? `Active scope: ${me.data.activeBranchName}` : "Active authorized workspace scope"} · {exceptionCount} open exception{exceptionCount === 1 ? "" : "s"}</p></div><StatusPill tone={exceptionCount ? "warn" : "ok"}>{exceptionCount ? "Review needed" : "Clear"}</StatusPill></div>
            <CategoryState pending={sales.isPending} error={sales.error} empty={!unknownPayments.length}>
              {unknownPayments.map((row) => <ExceptionRow key={row.id} index={1} title="Payment status unknown" detail={`${row.receiptNo} · ${money(row.totalMinor)} · ${formatDate(row.createdAt)} · confirm before retry`} priority="HIGH" owner="Finance" href={`/sales/${encodeURIComponent(row.id)}`} />)}
            </CategoryState>
            <CategoryState pending={counts.isPending} error={counts.error} empty={!countVariances.length}>
              {countVariances.map((count) => <ExceptionRow key={count.id} index={2} title="Stock count variance" detail={`${count.name} · ${count.lines.filter((line) => line.varianceQty).map((line) => `${line.productNameSnapshot} · ${Math.abs(line.varianceQty!)} ${line.varianceQty! < 0 ? "short" : "over"}`).join(", ")}`} priority="MEDIUM" owner="Inventory" href={`/inventory/counts/${encodeURIComponent(count.id)}`} />)}
            </CategoryState>
            <CategoryState pending={held.isPending} error={held.error} empty={!staleHeld.length}>
              {staleHeld.map((row) => <ExceptionRow key={row.heldId} index={3} title="Open held sale" detail={`${row.sale.registerId ?? "Register unavailable"} · waiting since ${formatDate(row.sale.createdAt)}`} priority="LOW" owner="Cashier" href="/pos" />)}
            </CategoryState>
            <CategoryState pending={orders.isPending} error={orders.error} empty={!delayedOrders.length}>
              {delayedOrders.map((row) => <ExceptionRow key={row.id} index={4} title="Web order handoff delayed" detail={`Order ${row.shortCode ?? row.id.slice(0, 8)} · ${row.status.toLowerCase().replaceAll("_", " ")} · submitted ${formatDate(row.submittedAt ?? row.createdAt)}`} priority="MEDIUM" owner="Orders" href={`/orders/${encodeURIComponent(row.id)}`} />)}
            </CategoryState>
            {exceptionCount === 0 && [sales, counts, held, orders].every((query) => !query.isPending && !query.isError) && <p className="rounded-lg bg-[#fafbf9] p-5 text-sm text-[#748078]">No operational exceptions need review in the current authorized scope.</p>}
            {[sales, counts, held, orders].some((query) => query.isError) && <p className="border-t border-[#e5e9e3] pt-3 text-xs text-[#748078]">Some categories may be hidden because your role does not have permission to view them. Their records remain protected in the linked workflows.</p>}
            {me.isError && <p role="alert" className="text-sm text-[#8c4337]">Workspace access could not be verified. Refresh and try again.</p>}
            {me.error instanceof ApiError && me.error.status === 401 && <p role="alert" className="text-sm text-[#8c4337]">Sign in to review operational exceptions.</p>}
          </Panel>
          <Panel className="h-fit space-y-4 p-4 sm:p-5">
            <h2 className="font-display text-base font-semibold text-[#202826]">Exception controls</h2>
            <p className="border-l-2 border-[#e7a59a] pl-3 text-sm leading-6 text-[#53615a]">Payment status unknown</p><p className="-mt-3 text-xs text-[#748078]">Confirm against provider and settlement records before any retry.</p>
            <p className="border-l-2 border-[#d6c28e] pl-3 text-sm leading-6 text-[#53615a]">Inventory count variance</p><p className="-mt-3 text-xs text-[#748078]">Review and post through the existing stock-count approval flow.</p>
            <p className="border-l-2 border-[#b8c8bb] pl-3 text-sm leading-6 text-[#53615a]">One-use protected actions</p><p className="-mt-3 text-xs text-[#748078]">This center is read-only. Authorization and execution remain in their source workflows.</p>
            <div className="flex flex-wrap gap-2 border-t border-[#e5e9e3] pt-3"><Link className="text-xs font-semibold text-[#267552] underline-offset-4 hover:underline" href="/customer-concerns">Approval inbox</Link><Link className="text-xs font-semibold text-[#267552] underline-offset-4 hover:underline" href="/reports/payments">Payment report</Link></div>
          </Panel>
        </div>}
    </main>
  </AppShell>;
}
