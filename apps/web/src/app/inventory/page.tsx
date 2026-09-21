"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../lib/api";
import { buildBalancesSearch, canAdjustInventory, statusLabel } from "../../lib/inventory";

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
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const balancesQuery = useQuery({
    queryKey: ["balances", view, page],
    queryFn: () => apiFetch<BalancesResult>(buildBalancesSearch({ view, page, pageSize: 20 })),
    retry: false,
  });

  async function recordMovement(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    const delta = Number(qty);
    if (!productId.trim()) {
      setError("VALIDATION: product id is required");
      return;
    }
    if (!Number.isInteger(delta) || delta === 0) {
      setError("VALIDATION: quantity must be a non-zero integer");
      return;
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
          }),
        },
      });
      setProductId("");
      setQty("");
      setReason("");
      await balancesQuery.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.code + ": " + err.message : "Record failed");
    }
  }

  if (balancesQuery.isLoading) return <main>Loading inventory…</main>;
  if (balancesQuery.isError)
    return (
      <main>
        <p role="alert">
          {balancesQuery.error instanceof ApiError
            ? balancesQuery.error.code + ": " + balancesQuery.error.message
            : "Could not load inventory."}
        </p>
      </main>
    );

  const data = balancesQuery.data!;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const role = meQuery.data?.role ?? "cashier";
  const adjustable = canAdjustInventory(role);

  return (
    <main>
      <Link href="/">Back to dashboard</Link>
      <h1>Inventory</h1>
      <nav aria-label="Stock views">
        {(["all", "low", "out"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => {
              setView(v);
              setPage(1);
            }}
          >
            {v === "all" ? "All stock" : v === "low" ? "Low stock" : "Out of stock"}
          </button>
        ))}
      </nav>
      <p>
        {data.total} product{data.total === 1 ? "" : "s"} — page {data.page} of {pages}
      </p>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>On hand</th>
            <th>Reorder at</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((b) => (
            <tr key={b.productId}>
              <td>
                <Link href={"/inventory/" + b.productId}>{b.productName}</Link>
              </td>
              <td style={{ fontVariantNumeric: "tabular-nums" }}>{b.qtyOnHand}</td>
              <td style={{ fontVariantNumeric: "tabular-nums" }}>{b.reorderLevel}</td>
              <td>
                <span aria-label={"stock status " + b.status}>[{statusLabel(b.status)}]</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          Previous
        </button>
        <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>
      {adjustable && (
        <section>
          <h2>Record movement</h2>
          <form onSubmit={(e) => void recordMovement(e)}>
            <label>
              Product ID
              <input value={productId} onChange={(e) => setProductId(e.target.value)} placeholder="Product ID" />
            </label>
            <label>
              Type
              <select value={type} onChange={(e) => setType(e.target.value)}>
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
            <label>
              Quantity (signed integer)
              <input
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="10 or -2"
                inputMode="numeric"
              />
            </label>
            <label>
              Reason (required for damage and adjustment)
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recount" />
            </label>
            <button type="submit">Record movement</button>
          </form>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
