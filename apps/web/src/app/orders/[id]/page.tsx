"use client";

import type { JSX } from "react";
import Link from "next/link";
import { use, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../../components/AppShell";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { DataTableFrame, PageHeader, Panel, SectionHeader } from "../../../components/premium";
import { DangerButton, GhostButton, PrimaryButton, StatusPill } from "../../../components/ui";
import { ApiError, apiFetch } from "../../../lib/api";
import {
  formatOrderMoney,
  isAgedOperationalHold,
  newOrderIdempotencyKey,
  orderCapabilitiesForRole,
  orderDetailActions,
  type PublicPaymentStatus,
  type StaffFulfillmentStatus,
  type StaffOrderStatus,
} from "../../../lib/orders";

interface Me { userId: string; role: string; businessName?: string }
interface OrderLine { id: string; name: string; sku: string | null; unit: string; qty: number; priceMinor: number; discountMinor: number; taxMinor: number; lineTotalMinor: number }
interface Reservation { id: string; productId: string; qty: number; status: string; expiresAt: string | null; createdAt: string }
interface Fulfillment {
  id: string;
  type: "PICKUP" | "DELIVERY";
  status: StaffFulfillmentStatus;
  branchId: string;
  assignedUserId: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  deliveryAddress: unknown | null;
  instructions: string | null;
  version: number;
  readyAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  collectedAt: string | null;
  failedAt: string | null;
  lines: Array<{ orderLineId: string; qty: number }>;
}
interface OrderDetail {
  order: {
    id: string; channel: "POS" | "WEB"; fulfillmentMode: "NONE" | "PICKUP" | "DELIVERY";
    paymentMode: "POS" | "PREPAID" | "PAY_AT_PICKUP"; branchId: string | null; customerId: string | null;
    contactName: string | null; email: string | null; phone: string | null; deliveryAddress: unknown | null;
    fulfillmentInstructions: string | null; currency: string; subtotalMinor: number; discountMinor: number; taxMinor: number;
    deliveryFeeMinor: number; deliveryTaxMinor: number; totalMinor: number; saleId: string | null; status: StaffOrderStatus;
    version: number; submittedAt: string | null; confirmedAt: string | null; completedAt: string | null; createdAt: string;
  };
  lines: OrderLine[];
  reservations: Reservation[];
  fulfillments: Fulfillment[];
  paymentStatus: PublicPaymentStatus;
  notificationStatus?: {
    state: "NOT_ATTEMPTED" | "ACCEPTED" | "FAILED" | "NOT_SENT";
    event: string | null;
    lastAttemptAt: string | null;
  };
}
interface Register { id: string; name: string; isActive: boolean; branchId: string | null }
interface Customer { id: string; name: string; email?: string | null; phone?: string | null }

function tone(status: string): "ok" | "warn" | "bad" | "info" {
  if (["COMPLETED","PAID","DELIVERED","COLLECTED","READY","REFUNDED"].includes(status)) return "ok";
  if (["CANCELLED","EXPIRED","REJECTED","FAILED","DELIVERY_FAILED"].includes(status)) return "bad";
  if (["SUBMITTED","UNKNOWN","HELD","PARTIALLY_REFUNDED"].includes(status)) return "warn";
  return "info";
}

function addressText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  return [row.line1, row.line2, row.city, row.region, row.postalCode, row.countryCode].filter((part) => typeof part === "string" && part.trim()).join(", ");
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }): JSX.Element {
  const { id } = use(params);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [customerOverrideReason, setCustomerOverrideReason] = useState("");
  const [confirmAction, setConfirmAction] = useState<"reject" | "cancel" | "revoke-access" | null>(null);
  const [registerId, setRegisterId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const detailQuery = useQuery({ queryKey: ["order", id], queryFn: () => apiFetch<OrderDetail>("/api/v1/orders/" + id), retry: false });
  const capabilities = orderCapabilitiesForRole(meQuery.data?.role);
  const registersQuery = useQuery({
    queryKey: ["registers-order-collection"],
    queryFn: () => apiFetch<{ items: Register[] }>("/api/v1/registers"),
    enabled: capabilities.collect,
    retry: false,
  });
  const customersQuery = useQuery({
    queryKey: ["order-customer-search", customerSearch],
    queryFn: () => apiFetch<{ items: Customer[] }>("/api/v1/customers?q=" + encodeURIComponent(customerSearch) + "&active=true&page=1&pageSize=20"),
    enabled: capabilities.linkCustomer && customerSearch.trim().length >= 2,
    retry: false,
  });
  const detail = detailQuery.data;
  const order = detail?.order;
  const activeRegisters = useMemo(
    () => (registersQuery.data?.items ?? []).filter((row) => row.isActive && (!order?.branchId || row.branchId === order.branchId)),
    [order?.branchId, registersQuery.data?.items],
  );

  async function mutate(path: string, body: Record<string, unknown>, label: string): Promise<boolean> {
    setBusy(label); setError(""); setMessage("");
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      await apiFetch(path, {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          headers: { "Idempotency-Key": newOrderIdempotencyKey() },
          body: JSON.stringify(body),
        },
      });
      await detailQuery.refetch();
      setMessage(label + " completed.");
      return true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "STALE_VERSION") {
        await detailQuery.refetch();
        setError("This Order changed in another session. The latest version has been reloaded.");
      } else {
        setError(cause instanceof ApiError ? cause.message : label + " failed.");
      }
      return false;
    } finally {
      setBusy("");
    }
  }

  async function orderAction(action: "accept" | "reject" | "cancel"): Promise<void> {
    if (!order) return;
    await mutate("/api/v1/orders/" + order.id + "/" + action, {
      expectedVersion: order.version,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    }, action === "accept" ? "Accept order" : action === "reject" ? "Reject order" : "Cancel order");
  }

  async function fulfillmentAction(fulfillment: Fulfillment, action: string): Promise<void> {
    if (!order || !meQuery.data) return;
    if (action === "assign") {
      await mutate(
        "/api/v1/orders/" + order.id + "/fulfillments/" + fulfillment.id + "/assign",
        { expectedVersion: fulfillment.version, assignedUserId: fulfillment.assignedUserId === meQuery.data.userId ? null : meQuery.data.userId },
        fulfillment.assignedUserId === meQuery.data.userId ? "Unassign fulfillment" : "Assign fulfillment",
      );
      return;
    }
    if (action === "collect") {
      if (order.paymentMode === "PAY_AT_PICKUP" && !registerId) {
        setError("Choose an active register before collecting a pay-at-pickup Order.");
        return;
      }
      await mutate(
        "/api/v1/orders/" + order.id + "/fulfillments/" + fulfillment.id + "/collect",
        {
          expectedVersion: fulfillment.version,
          ...(order.paymentMode === "PAY_AT_PICKUP" ? {
            registerId,
            branchId: order.branchId,
            payments: [{ method: "cash", amountMinor: order.totalMinor }],
          } : {}),
        },
        "Collect order",
      );
      return;
    }
    await mutate(
      "/api/v1/orders/" + order.id + "/fulfillments/" + fulfillment.id + "/" + action,
      { expectedVersion: fulfillment.version },
      action[0].toUpperCase() + action.slice(1) + " fulfillment",
    );
  }

  async function accessAction(action: "resend" | "revoke"): Promise<void> {
    if (!order) return;
    if (action === "revoke") {
      await mutate("/api/v1/orders/" + order.id + "/access/revoke", {}, "Revoke status links");
      return;
    }
    setBusy("Resend status link"); setError(""); setMessage("");
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      const result = await apiFetch<{ sent: boolean; replayed: boolean }>(
        "/api/v1/orders/" + order.id + "/access/resend", {
          csrfToken: csrf.csrfToken,
          init: { method: "POST", headers: { "Idempotency-Key": newOrderIdempotencyKey() }, body: "{}" },
        },
      );
      await detailQuery.refetch();
      if (result.sent) {
        setMessage("Status link accepted by the email provider. Inbox delivery is not guaranteed.");
      } else {
        setError("Status link was not sent. Check the order email and delivery configuration before retrying.");
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Resend status link failed.");
    } finally {
      setBusy("");
    }
  }

  async function linkCustomer(customerId: string): Promise<void> {
    if (!order) return;
    if (await mutate("/api/v1/orders/" + order.id + "/link-customer", {
      expectedVersion: order.version,
      customerId,
      ...(customerOverrideReason.trim() ? { overrideReason: customerOverrideReason.trim() } : {}),
    }, "Link customer")) {
      setCustomerSearch("");
      setCustomerOverrideReason("");
    }
  }

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1180px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Commerce / Order detail"
          title={order ? "Order " + order.id.slice(-8).toUpperCase() : "Order"}
          description="Customer intent, payment projection, reservations, and physical fulfillment remain separate and explicit."
          actions={<Link href="/orders" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">Back to Orders</Link>}
        />

        {detailQuery.isLoading ? <Panel className="p-6"><p role="status" className="text-sm text-[#73685f]">Loading Order…</p></Panel> : null}
        {detailQuery.isError ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><p role="alert" className="text-sm font-medium text-[#c43e3e]">Order could not be loaded.</p><GhostButton type="button" onClick={() => void detailQuery.refetch()}>Retry</GhostButton></div></Panel> : null}
        {message ? <div role="status" className="rounded-xl border border-[#cfe9dc] bg-[#eaf7f0] px-4 py-3 text-sm font-medium text-[#1f8a5b]">{message}</div> : null}
        {error ? <div role="alert" className="rounded-xl border border-[#efb9b9] bg-[#fff0f0] px-4 py-3 text-sm font-medium text-[#c43e3e]">{error}</div> : null}

        {detail && order ? (
          <>
            <section className="grid gap-4 md:grid-cols-3">
              <Panel className="p-5"><p className="font-data text-[9px] uppercase tracking-[0.1em] text-[#9a8d83]">Order state</p><div className="mt-3"><StatusPill tone={tone(order.status)}>{order.status}</StatusPill></div><p className="mt-3 text-[11px] text-[#73685f]">Version {order.version} · {order.fulfillmentMode}</p></Panel>
              <Panel className="p-5"><p className="font-data text-[9px] uppercase tracking-[0.1em] text-[#9a8d83]">Payment</p><div className="mt-3"><StatusPill tone={tone(detail.paymentStatus)}>{detail.paymentStatus.replaceAll("_"," ")}</StatusPill></div><p className="mt-3 text-[11px] text-[#73685f]">{order.paymentMode.replaceAll("_"," ")}</p></Panel>
              <Panel className="p-5"><p className="font-data text-[9px] uppercase tracking-[0.1em] text-[#9a8d83]">Frozen total</p><p className="font-display mt-2 text-2xl font-bold">{formatOrderMoney(order.totalMinor, order.currency)}</p><p className="mt-2 text-[10px] text-[#8d8178]">Submitted totals are immutable.</p></Panel>
            </section>

            <div className="grid gap-5 lg:grid-cols-[1.3fr_.7fr]">
              <Panel className="p-5">
                <SectionHeader title="Customer snapshot" description="Submitted contact data is immutable. CRM linking does not rewrite this snapshot." />
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="text-[10px] font-semibold text-[#8d8178]">Name</dt><dd className="mt-1 font-medium">{order.contactName ?? "Not supplied"}</dd></div>
                  <div><dt className="text-[10px] font-semibold text-[#8d8178]">CRM link</dt><dd className="mt-1 font-medium">{order.customerId ? "Linked" : "Not linked"}</dd></div>
                  {order.email !== null ? <div><dt className="text-[10px] font-semibold text-[#8d8178]">Email</dt><dd className="mt-1 break-all">{order.email}</dd></div> : null}
                  {order.phone !== null ? <div><dt className="text-[10px] font-semibold text-[#8d8178]">Phone</dt><dd className="mt-1">{order.phone}</dd></div> : null}
                  {order.deliveryAddress !== null ? <div className="sm:col-span-2"><dt className="text-[10px] font-semibold text-[#8d8178]">Delivery address</dt><dd className="mt-1">{addressText(order.deliveryAddress)}</dd></div> : null}
                  {order.fulfillmentInstructions !== null ? <div className="sm:col-span-2"><dt className="text-[10px] font-semibold text-[#8d8178]">Instructions</dt><dd className="mt-1">{order.fulfillmentInstructions}</dd></div> : null}
                </dl>
                {order.email === null && order.phone === null && order.fulfillmentMode === "DELIVERY" ? <p className="mt-4 rounded-xl bg-[#f7f1ea] px-4 py-3 text-[11px] leading-5 text-[#73685f]">Delivery contact details are redacted by the server for this session.</p> : null}
              </Panel>

              <Panel className="p-5">
                <SectionHeader title="Order actions" description="Every mutation is versioned, idempotent, audited, and server-authorized." />
                {capabilities.manageAccess && detail.notificationStatus ? (
                  <section aria-label="Status-link delivery history" className="mt-4 rounded-xl border border-[#e5e9e3] bg-[#f8faf7] p-4">
                    <p className="text-[12px] font-semibold text-[#202826]">Status-link delivery</p>
                    <p className="mt-2 text-[12px] text-[#53615a]">
                      {detail.notificationStatus.state === "ACCEPTED"
                        ? "Accepted by the email provider; inbox delivery is not confirmed."
                        : detail.notificationStatus.state === "FAILED"
                          ? "Last recorded notification attempt failed."
                          : detail.notificationStatus.state === "NOT_SENT"
                            ? "Last resend did not send a status link."
                            : "No notification attempt is recorded."}
                    </p>
                    {detail.notificationStatus.lastAttemptAt ? (
                      <p className="mt-2 text-[11px] text-[#71807a]">
                        Last recorded attempt: {new Date(detail.notificationStatus.lastAttemptAt).toLocaleString()}
                      </p>
                    ) : null}
                  </section>
                ) : null}
                <label className="mt-4 block text-[11px] font-semibold text-[#655b53]">Action reason <span className="font-normal text-[#9a8d83]">(optional)</span><input className="field mt-2" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
                <div className="mt-4 flex flex-wrap gap-2">
                  {orderDetailActions({ role: meQuery.data?.role, orderStatus: order.status, paymentMode: order.paymentMode, fulfillment: null }).includes("accept") ? <PrimaryButton type="button" disabled={Boolean(busy)} onClick={() => void orderAction("accept")}>Accept order</PrimaryButton> : null}
                  {orderDetailActions({ role: meQuery.data?.role, orderStatus: order.status, paymentMode: order.paymentMode, fulfillment: null }).includes("reject") ? <DangerButton type="button" disabled={Boolean(busy)} onClick={() => setConfirmAction("reject")}>Reject order</DangerButton> : null}
                  {orderDetailActions({ role: meQuery.data?.role, orderStatus: order.status, paymentMode: order.paymentMode, fulfillment: null }).includes("cancel") ? <DangerButton type="button" disabled={Boolean(busy)} onClick={() => setConfirmAction("cancel")}>Cancel order</DangerButton> : null}
                  {capabilities.manageAccess && ["SUBMITTED","CONFIRMED","COMPLETED"].includes(order.status) ? <><GhostButton type="button" disabled={Boolean(busy)} onClick={() => void accessAction("resend")}>Resend status link</GhostButton><GhostButton type="button" disabled={Boolean(busy)} onClick={() => setConfirmAction("revoke-access")}>Revoke status links</GhostButton></> : null}
                </div>
                {busy ? <p role="status" className="mt-3 text-[11px] text-[#73685f]">{busy}…</p> : null}
              </Panel>
            </div>

            {capabilities.linkCustomer && !order.customerId ? (
              <Panel className="p-5">
                <SectionHeader title="Link CRM customer" description="Search existing customers. The server requires a matching normalized email/phone unless an authorized override reason is provided." />
                <label className="mt-4 block max-w-lg text-[11px] font-semibold text-[#655b53]">Search customers<input className="field mt-2" value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Name, email, or phone" /></label>
                <label className="mt-3 block max-w-lg text-[11px] font-semibold text-[#655b53]">Mismatch override reason <span className="font-normal text-[#9a8d83]">(owner/manager only; leave blank when contact matches)</span><input className="field mt-2" value={customerOverrideReason} onChange={(event) => setCustomerOverrideReason(event.target.value)} placeholder="Why this customer should be linked" /></label>
                {customersQuery.isFetching ? <p role="status" className="mt-3 text-sm text-[#73685f]">Searching customers…</p> : null}
                {(customersQuery.data?.items ?? []).length > 0 ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{customersQuery.data!.items.map((customer) => <button type="button" key={customer.id} disabled={Boolean(busy)} onClick={() => void linkCustomer(customer.id)} className="rounded-xl border border-[#e4d9d0] p-3 text-left hover:border-[#f35d3f]"><span className="block text-sm font-semibold">{customer.name}</span><span className="mt-1 block text-[10px] text-[#73685f]">{customer.email ?? customer.phone ?? "No contact"}</span></button>)}</div> : null}
              </Panel>
            ) : null}

            <Panel className="p-5">
              <SectionHeader title="Frozen Order lines" description="These quantities and prices are the submitted snapshot used for reservation and Sale creation." />
              <DataTableFrame className="mt-4 !shadow-none">
                <table className="premium-table min-w-[720px] text-left text-[12px]"><thead><tr><th className="px-4 py-3">Product</th><th>SKU</th><th className="text-right">Qty</th><th className="text-right">Unit</th><th className="pr-4 text-right">Line total</th></tr></thead><tbody>{detail.lines.map((line) => <tr key={line.id}><td className="px-4 py-3 font-semibold">{line.name}</td><td className="font-data py-3 text-[#73685f]">{line.sku ?? "—"}</td><td className="font-data py-3 text-right">{line.qty}</td><td className="font-data py-3 text-right">{formatOrderMoney(line.priceMinor, order.currency)}</td><td className="font-data py-3 pr-4 text-right font-semibold">{formatOrderMoney(line.lineTotalMinor + line.taxMinor - line.discountMinor, order.currency)}</td></tr>)}</tbody></table>
              </DataTableFrame>
            </Panel>

            <Panel className="p-5">
              <SectionHeader title="Inventory reservations" description="HELD rows reduce available-to-sell. Staff resolve aged holds through normal Order cancellation, never by force-breaking reservations." />
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {detail.reservations.map((reservation) => {
                  const aged = isAgedOperationalHold(reservation);
                  return <article key={reservation.id} className={"rounded-xl border p-4 " + (aged ? "border-[#e8bc78] bg-[#fff8ea]" : "border-[#eee4db] bg-[#fffdfb]")}><div className="flex items-center justify-between gap-3"><StatusPill tone={tone(reservation.status)}>{reservation.status}</StatusPill>{aged ? <span className="rounded-full bg-[#fff4df] px-2.5 py-1 text-[10px] font-semibold text-[#9a5c08]">Aged operational hold</span> : null}</div><p className="font-data mt-3 text-[10px] text-[#73685f]">Qty {reservation.qty} · {reservation.expiresAt ? "Expires " + new Date(reservation.expiresAt).toLocaleString("en-PH") : "No automatic expiry"}</p></article>;
                })}
                {detail.reservations.length === 0 ? <p className="text-sm text-[#8d8178]">No inventory reservations for this Order.</p> : null}
              </div>
            </Panel>

            <section className="space-y-4" aria-label="Fulfillments">
              {detail.fulfillments.map((fulfillment) => {
                const actions = orderDetailActions({ role: meQuery.data?.role, orderStatus: order.status, paymentMode: order.paymentMode, fulfillment });
                return (
                  <Panel key={fulfillment.id} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3"><SectionHeader title={fulfillment.type === "PICKUP" ? "Pickup fulfillment" : "Delivery fulfillment"} description={"Allocation " + fulfillment.lines.reduce((sum, row) => sum + row.qty, 0) + " unit(s) · Version " + fulfillment.version} /><StatusPill tone={tone(fulfillment.status)}>{fulfillment.status.replaceAll("_"," ")}</StatusPill></div>
                    <p className="mt-3 text-[11px] text-[#73685f]">Assignment: {fulfillment.assignedUserId === meQuery.data?.userId ? "Assigned to you" : fulfillment.assignedUserId ? "Assigned to another staff member" : "Unassigned"}</p>
                    {fulfillment.deliveryAddress !== null ? <p className="mt-2 text-[11px] text-[#73685f]">Delivery: {addressText(fulfillment.deliveryAddress)}</p> : null}
                    {fulfillment.email !== null || fulfillment.phone !== null ? <p className="mt-1 text-[11px] text-[#73685f]">{[fulfillment.email, fulfillment.phone].filter(Boolean).join(" · ")}</p> : null}
                    {order.paymentMode === "PAY_AT_PICKUP" && actions.includes("collect") ? <label className="mt-4 block max-w-sm text-[11px] font-semibold text-[#655b53]">Register<select className="field mt-2" value={registerId} onChange={(event) => setRegisterId(event.target.value)}><option value="">Choose active register</option>{activeRegisters.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label> : null}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {actions.includes("assign") ? <GhostButton type="button" disabled={Boolean(busy)} onClick={() => void fulfillmentAction(fulfillment, "assign")}>{fulfillment.assignedUserId === meQuery.data?.userId ? "Unassign" : "Assign to me"}</GhostButton> : null}
                      {actions.includes("ready") ? <PrimaryButton type="button" disabled={Boolean(busy)} onClick={() => void fulfillmentAction(fulfillment, "ready")}>Mark ready</PrimaryButton> : null}
                      {actions.includes("pack") ? <PrimaryButton type="button" disabled={Boolean(busy)} onClick={() => void fulfillmentAction(fulfillment, "pack")}>Mark packed</PrimaryButton> : null}
                      {actions.includes("dispatch") ? <PrimaryButton type="button" disabled={Boolean(busy)} onClick={() => void fulfillmentAction(fulfillment, "dispatch")}>Dispatch</PrimaryButton> : null}
                      {actions.includes("deliver") ? <PrimaryButton type="button" disabled={Boolean(busy)} onClick={() => void fulfillmentAction(fulfillment, "deliver")}>Mark delivered</PrimaryButton> : null}
                      {actions.includes("fail") ? <DangerButton type="button" disabled={Boolean(busy)} onClick={() => void fulfillmentAction(fulfillment, "fail")}>Delivery failed</DangerButton> : null}
                      {actions.includes("collect") ? <PrimaryButton type="button" disabled={Boolean(busy)} onClick={() => void fulfillmentAction(fulfillment, "collect")}>Collect order</PrimaryButton> : null}
                    </div>
                  </Panel>
                );
              })}
              {detail.fulfillments.length === 0 ? <Panel className="p-5"><p className="text-sm text-[#8d8178]">No fulfillment has been created yet.</p></Panel> : null}
            </section>
          </>
        ) : null}
      </main>
      <ConfirmDialog
        open={confirmAction !== null}
        onCancel={() => !busy && setConfirmAction(null)}
        onConfirm={() => {
          const action = confirmAction;
          setConfirmAction(null);
          if (action === "reject") void orderAction("reject");
          else if (action === "cancel") void orderAction("cancel");
          else if (action === "revoke-access") void accessAction("revoke");
        }}
        busy={Boolean(busy)}
        title={confirmAction === "reject" ? "Reject this Order?" : confirmAction === "cancel" ? "Cancel this Order?" : "Revoke customer status links?"}
        description={
          confirmAction === "revoke-access"
            ? "Previously issued public status links will stop working. Staff can resend a new link later."
            : "This uses the normal audited Order transition and releases eligible held inventory. It does not bypass reservations or financial reversal rules."
        }
        confirmLabel={confirmAction === "reject" ? "Reject Order" : confirmAction === "cancel" ? "Cancel Order" : "Revoke links"}
      />
    </AppShell>
  );
}
