"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { DataTableFrame, PageHeader, Panel, SectionHeader } from "../../components/premium";
import { GhostButton, StatusPill } from "../../components/ui";
import { apiFetch } from "../../lib/api";
import {
  buildOrderListPath,
  formatOrderMoney,
  orderCapabilitiesForRole,
  type PublicPaymentStatus,
  type StaffOrderStatus,
} from "../../lib/orders";

interface Me { role: string; businessName?: string }
interface Branch { id: string; name: string }
interface OrderRow {
  id: string;
  channel: "POS" | "WEB";
  fulfillmentMode: "NONE" | "PICKUP" | "DELIVERY";
  paymentMode: "POS" | "PREPAID" | "PAY_AT_PICKUP";
  branchId: string | null;
  contactName: string | null;
  currency: string;
  totalMinor: number;
  status: StaffOrderStatus;
  paymentStatus: PublicPaymentStatus;
  createdAt: string;
  updatedAt: string;
}
interface OrderPage { items: OrderRow[]; nextCursor: string | null }

function tone(status: string): "ok" | "warn" | "bad" | "info" {
  if (["COMPLETED", "PAID", "REFUNDED"].includes(status)) return "ok";
  if (["FAILED", "CANCELLED", "EXPIRED", "REJECTED"].includes(status)) return "bad";
  if (["SUBMITTED", "UNKNOWN", "PARTIALLY_REFUNDED", "DELIVERY_FAILED"].includes(status)) return "warn";
  return "info";
}

export default function OrdersPage(): JSX.Element {
  const [status, setStatus] = useState<StaffOrderStatus | "">("");
  const [fulfillmentMode, setFulfillmentMode] = useState<"" | "PICKUP" | "DELIVERY">("");
  const [paymentStatus, setPaymentStatus] = useState<PublicPaymentStatus | "">("");
  const [branchId, setBranchId] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<Array<string | undefined>>([]);
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiFetch<{ items: Branch[] }>("/api/v1/branches"),
    retry: false,
  });
  const capabilities = orderCapabilitiesForRole(meQuery.data?.role);
  const path = buildOrderListPath({
    limit: 25,
    ...(status ? { status } : {}),
    ...(fulfillmentMode ? { fulfillmentMode } : {}),
    ...(paymentStatus ? { paymentStatus } : {}),
    ...(branchId ? { branchId } : {}),
    ...(cursor ? { cursor } : {}),
  });
  const listQuery = useQuery({
    queryKey: ["orders", status, fulfillmentMode, paymentStatus, branchId, cursor],
    queryFn: () => apiFetch<OrderPage>(path),
    enabled: capabilities.view,
    retry: false,
  });
  const branchName = (id: string | null): string =>
    id ? branchesQuery.data?.items.find((branch) => branch.id === id)?.name ?? "Unknown branch" : "No branch";

  function resetCursor(): void {
    setCursor(undefined);
    setHistory([]);
  }
  function next(): void {
    if (!listQuery.data?.nextCursor) return;
    setHistory((current) => [...current, cursor]);
    setCursor(listQuery.data.nextCursor);
  }
  function previous(): void {
    setHistory((current) => {
      const copy = [...current];
      setCursor(copy.pop());
      return copy;
    });
  }

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Commerce / Fulfillment"
          title="Orders"
          description="Work the bounded Order queue by payment, fulfillment, branch, and lifecycle state. Inventory reservations remain server-authoritative."
          actions={capabilities.settings ? <Link href="/admin/online-ordering" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">Online ordering settings</Link> : undefined}
        />

        {!meQuery.isLoading && !capabilities.view ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-5"><SectionHeader title="Orders are restricted" description="Your current role cannot view Orders." /></Panel> : null}

        {capabilities.view ? (
          <>
            <Panel className="p-4 sm:p-5">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label className="text-[11px] font-semibold text-[#655b53]">Order status
                  <select className="field mt-2" value={status} onChange={(event) => { setStatus(event.target.value as StaffOrderStatus | ""); resetCursor(); }}>
                    <option value="">All statuses</option>
                    {["SUBMITTED","CONFIRMED","COMPLETED","CANCELLED","EXPIRED","REJECTED"].map((value) => <option key={value} value={value}>{value.replaceAll("_"," ")}</option>)}
                  </select>
                </label>
                <label className="text-[11px] font-semibold text-[#655b53]">Fulfillment
                  <select className="field mt-2" value={fulfillmentMode} onChange={(event) => { setFulfillmentMode(event.target.value as "" | "PICKUP" | "DELIVERY"); resetCursor(); }}>
                    <option value="">All methods</option><option value="PICKUP">Pickup</option><option value="DELIVERY">Delivery</option>
                  </select>
                </label>
                <label className="text-[11px] font-semibold text-[#655b53]">Payment
                  <select className="field mt-2" value={paymentStatus} onChange={(event) => { setPaymentStatus(event.target.value as PublicPaymentStatus | ""); resetCursor(); }}>
                    <option value="">All payment states</option>
                    {["UNPAID","PENDING","UNKNOWN","FAILED","PAID","PARTIALLY_REFUNDED","REFUNDED"].map((value) => <option key={value} value={value}>{value.replaceAll("_"," ")}</option>)}
                  </select>
                </label>
                <label className="text-[11px] font-semibold text-[#655b53]">Branch
                  <select className="field mt-2" value={branchId} onChange={(event) => { setBranchId(event.target.value); resetCursor(); }}>
                    <option value="">All permitted branches</option>
                    {(branchesQuery.data?.items ?? []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select>
                </label>
              </div>
            </Panel>

            {listQuery.isLoading ? <Panel className="p-6"><p role="status" className="text-sm text-[#73685f]">Loading Orders…</p></Panel> : null}
            {listQuery.isError ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><p role="alert" className="text-sm font-medium text-[#c43e3e]">Orders could not be loaded.</p><GhostButton type="button" onClick={() => void listQuery.refetch()}>Retry</GhostButton></div></Panel> : null}
            {listQuery.data && listQuery.data.items.length === 0 ? <Panel className="p-6"><SectionHeader title="No Orders match these filters" description="Clear or change the filters to return to the active queue." /></Panel> : null}

            {listQuery.data && listQuery.data.items.length > 0 ? (
              <DataTableFrame>
                <table className="premium-table min-w-[960px] text-left text-[12px]">
                  <thead><tr><th className="px-5 py-4">Order</th><th>Customer</th><th>Branch</th><th>Fulfillment</th><th>Payment</th><th>Status</th><th className="text-right">Total</th><th className="pr-5 text-right">Created</th></tr></thead>
                  <tbody>
                    {listQuery.data.items.map((order) => (
                      <tr key={order.id}>
                        <td className="px-5 py-4"><Link href={"/orders/" + order.id} className="font-data font-semibold text-[#d94a30] hover:underline">{order.id.slice(-8).toUpperCase()}</Link><p className="mt-1 text-[9px] text-[#9a8d83]">{order.channel}</p></td>
                        <td className="py-4 font-medium text-[#2a241f]">{order.contactName ?? "Walk-in"}</td>
                        <td className="py-4 text-[#73685f]">{branchName(order.branchId)}</td>
                        <td className="py-4 text-[#73685f]">{order.fulfillmentMode}</td>
                        <td className="py-4"><StatusPill tone={tone(order.paymentStatus)}>{order.paymentStatus.replaceAll("_"," ")}</StatusPill></td>
                        <td className="py-4"><StatusPill tone={tone(order.status)}>{order.status}</StatusPill></td>
                        <td className="font-data py-4 text-right font-semibold">{formatOrderMoney(order.totalMinor, order.currency)}</td>
                        <td className="font-data py-4 pr-5 text-right text-[10px] text-[#73685f]">{new Date(order.createdAt).toLocaleString("en-PH")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DataTableFrame>
            ) : null}

            {listQuery.data ? (
              <nav aria-label="Order pages" className="flex items-center justify-between gap-3">
                <GhostButton type="button" disabled={history.length === 0 || listQuery.isFetching} onClick={previous}>Previous</GhostButton>
                <span className="font-data text-[10px] text-[#8d8178]">Showing up to 25 Orders</span>
                <GhostButton type="button" disabled={!listQuery.data.nextCursor || listQuery.isFetching} onClick={next}>Next</GhostButton>
              </nav>
            ) : null}
          </>
        ) : null}
      </main>
    </AppShell>
  );
}
