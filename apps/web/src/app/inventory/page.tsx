"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { ManagerApprovalDialog } from "../../components/ManagerApprovalDialog";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
import { ApiError, apiFetch } from "../../lib/api";
import { buildBalancesSearch, canAdjustInventory, statusLabel } from "../../lib/inventory";
import { inventoryStatus } from "../../lib/inventory-view";

interface BalanceRow {
  productId: string;
  productName: string;
  qtyOnHand: number;
  reorderLevel: number;
  trackInventory: boolean;
  status: string;
}

interface BalancesResult {
  items: BalanceRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface Me {
  role: string;
  businessName?: string;
  activeBranchId: string | null;
  activeBranchName: string | null;
}

interface Csrf {
  csrfToken: string;
}

export default function InventoryPage(): JSX.Element {
  const [view, setView] = useState("all");
  const [page, setPage] = useState(1);
  const [productId, setProductId] = useState("");
  const [type, setType] = useState("receive");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [approvalOpen, setApprovalOpen] = useState(false);
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const balancesQuery = useQuery({
    queryKey: ["balances", view, page, meQuery.data?.activeBranchId ?? null],
    queryFn: () => apiFetch<BalancesResult>(buildBalancesSearch({
      view,
      page,
      pageSize: 20,
      branchId: meQuery.data?.activeBranchId ?? undefined,
    })),
    retry: false,
    enabled: meQuery.data !== undefined,
  });

  async function submitMovement(approvalToken?: string): Promise<boolean> {
    const delta = Number(qty);
    if (!productId.trim()) {
      setError("VALIDATION: product id is required");
      return false;
    }
    if (!Number.isInteger(delta) || delta === 0) {
      setError("VALIDATION: quantity must be a non-zero integer");
      return false;
    }
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/inventory/movements", {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          body: JSON.stringify({
            productId: productId.trim(),
            type,
            qtyDelta: delta,
            reason: reason.trim() ? reason.trim() : undefined,
            branchId: meQuery.data?.activeBranchId ?? undefined,
            ...(approvalToken ? { approvalToken } : {}),
          }),
        },
      });
      setProductId("");
      setQty("");
      setReason("");
      await balancesQuery.refetch();
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === "FORBIDDEN" && !approvalToken) {
        setApprovalOpen(true);
      } else {
        setError(err instanceof ApiError ? err.code + ": " + err.message : "Record failed");
      }
      return false;
    }
  }

  async function recordMovement(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    await submitMovement();
  }

  if (meQuery.isLoading || balancesQuery.isPending) {
    return (
      <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
        <main className="mx-auto max-w-[1240px] p-6"><Panel className="p-6 text-sm text-[#73685f]">Loading inventory…</Panel></main>
      </AppShell>
    );
  }

  if (meQuery.isError || balancesQuery.isError) {
    return (
      <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
        <main className="mx-auto max-w-[1240px] p-6">
          <Panel className="border-[#efb9b9] bg-[#fff0f0] p-6">
            <p role="alert" className="text-sm font-medium text-[#9d3030]">
              {balancesQuery.error instanceof ApiError
                ? balancesQuery.error.code + ": " + balancesQuery.error.message
                : meQuery.error instanceof ApiError
                  ? meQuery.error.code + ": " + meQuery.error.message
                  : "Could not load inventory."}
            </p>
          </Panel>
        </main>
      </AppShell>
    );
  }

  const data = balancesQuery.data!;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const role = meQuery.data?.role ?? "cashier";
  const adjustable = canAdjustInventory(role) || role === "cashier";
  const visibleLow = data.items.filter((item) => inventoryStatus(item.qtyOnHand, item.reorderLevel) === "low").length;
  const visibleOut = data.items.filter((item) => inventoryStatus(item.qtyOnHand, item.reorderLevel) === "out").length;
  const visibleHealthy = data.items.filter((item) => inventoryStatus(item.qtyOnHand, item.reorderLevel) === "healthy").length;
  const visibleUnits = data.items.reduce((sum, item) => sum + Math.max(0, item.qtyOnHand), 0);

  return (
    <AppShell businessName={meQuery.data?.businessName} role={role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Inventory / Stock control"
          title="Inventory"
          description={
            meQuery.data?.activeBranchName
              ? "Viewing stock for " + meQuery.data.activeBranchName + ". Track on-hand inventory and audited movement within this branch."
              : "Viewing all branch scopes. Select an active branch in the workspace header when you need location-specific stock."
          }
          actions={<Link href="/transfers" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">View transfers</Link>}
        />

        <section aria-label="Inventory summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Visible on hand" value={visibleUnits.toLocaleString("en-PH")} icon="□" meta={"Across " + data.items.length + " visible products"} />
          <MetricCard label="Healthy" value={visibleHealthy} icon="✓" tone="success" meta="Current page" />
          <MetricCard label="Low stock" value={visibleLow} icon="!" tone="warning" meta="At or below reorder level" />
          <MetricCard label="Out of stock" value={visibleOut} icon="×" tone={visibleOut > 0 ? "warning" : "success"} meta="Zero on hand" />
        </section>

        <Panel className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeader title="Stock views" description="Status is always written out; color is only a supporting signal." />
            <nav aria-label="Stock views" className="flex flex-wrap gap-2">
              {(["all", "low", "out"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={view === item}
                  onClick={() => {
                    setView(item);
                    setPage(1);
                  }}
                  className={"rounded-full px-3 py-2 text-[11px] font-semibold " + (view === item ? "bg-[#fff0ea] text-[#e44e34]" : "border border-[#e4d9d0] bg-white text-[#73685f]")}
                >
                  {item === "all" ? "All stock" : item === "low" ? "Low stock" : "Out of stock"}
                </button>
              ))}
            </nav>
          </div>
        </Panel>

        <DataTableFrame>
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            <div>
              <h2 className="font-display text-base font-semibold">Inventory balances</h2>
              <p className="mt-1 text-[11px] text-[#7a6f66]">{data.total} product{data.total === 1 ? "" : "s"} · page {data.page} of {pages}</p>
            </div>
          </div>
          <table className="premium-table min-w-[720px] text-left text-[12px]">
            <thead>
              <tr>
                <th className="px-5 pb-3">Product</th>
                <th className="px-5 pb-3 text-right">On hand</th>
                <th className="px-5 pb-3 text-right">Reorder at</th>
                <th className="px-5 pb-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => {
                const health = inventoryStatus(item.qtyOnHand, item.reorderLevel);
                return (
                  <tr key={item.productId}>
                    <td className="px-5 py-3"><Link href={"/inventory/" + item.productId} className="font-semibold text-[#2a241f] hover:text-[#d94a30]">{item.productName}</Link></td>
                    <td className="font-data px-5 py-3 text-right font-medium">{item.qtyOnHand}</td>
                    <td className="font-data px-5 py-3 text-right text-[#73685f]">{item.reorderLevel}</td>
                    <td className="px-5 py-3 text-right">
                      <StatusPill tone={health === "healthy" ? "ok" : health === "low" ? "warn" : "bad"}>{statusLabel(item.status)}</StatusPill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.items.length === 0 ? <div className="border-t border-[#eee6de] px-5 py-10 text-center text-sm text-[#8b8077]">No products are in this stock view.</div> : null}
          <div className="flex justify-end gap-2 border-t border-[#eee6de] px-5 py-4">
            <GhostButton type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</GhostButton>
            <GhostButton type="button" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>Next</GhostButton>
          </div>
        </DataTableFrame>

        {adjustable ? (
          <Panel className="p-5">
            <SectionHeader title="Record movement" description="Receipts, damage, adjustments, returns, counts, and transfers remain explicit audited movements." />
            <form noValidate onSubmit={(event) => void recordMovement(event)} className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_1fr_.8fr_1.4fr_auto]">
              <label className="text-[11px] font-semibold text-[#655b53]">
                Product ID
                <input value={productId} onChange={(event) => setProductId(event.target.value)} placeholder="Product ID" className="field mt-1.5" />
              </label>
              <label className="text-[11px] font-semibold text-[#655b53]">
                Movement type
                <select value={type} onChange={(event) => setType(event.target.value)} className="field mt-1.5">
                  <option value="opening_stock">Opening stock</option>
                  <option value="receive">Receive</option>
                  <option value="sale">Sale</option>
                  <option value="return">Return</option>
                  <option value="damage">Damage</option>
                  <option value="adjustment">Adjustment</option>
                  <option value="transfer_in">Transfer in</option>
                  <option value="transfer_out">Transfer out</option>
                  <option value="stock_count">Stock count</option>
                </select>
              </label>
              <label className="text-[11px] font-semibold text-[#655b53]">
                Quantity
                <input value={qty} onChange={(event) => setQty(event.target.value)} placeholder="10 or -2" inputMode="numeric" className="field mt-1.5 font-data" />
              </label>
              <label className="text-[11px] font-semibold text-[#655b53]">
                Reason
                <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required for damage and adjustment" className="field mt-1.5" />
              </label>
              <PrimaryButton type="submit" className="self-end">Record</PrimaryButton>
            </form>
            {error ? <p role="alert" className="mt-3 rounded-xl bg-[#fff0f0] px-3 py-2 text-sm font-medium text-[#c43e3e]">{error}</p> : null}
          </Panel>
        ) : null}
      </main>
      <ManagerApprovalDialog
        open={approvalOpen}
        permission="inventory.adjust"
        action={{ kind: "inventory_movement", productId: productId.trim(), movementType: type, qtyDelta: Number(qty), ...(reason.trim() ? { reason: reason.trim() } : {}), ...(meQuery.data?.activeBranchId ? { branchId: meQuery.data.activeBranchId } : {}) }}
        description="This stock movement requires manager authorization before it is written to the inventory ledger."
        summary={`Product ${productId.trim() || "—"} · ${type.replaceAll("_", " ")} · ${qty || "0"} units`}
        onApproved={(grant) => submitMovement(grant.token)}
        onClose={() => setApprovalOpen(false)}
      />
    </AppShell>
  );
}
