"use client";

import type { JSX } from "react";

import Link from "next/link";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../../lib/api";
import { canAdjustInventory } from "../../../lib/inventory";

interface MovementRow {
  id: string;
  type: string;
  qtyDelta: number;
  reason: string | null;
  actorId: string;
}

interface HistoryResult {
  items: MovementRow[];
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

export default function MovementHistoryPage({ params }: { params: Promise<{ productId: string }> }): JSX.Element {
  const { productId } = use(params);
  const [type, setType] = useState("receive");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const historyQuery = useQuery({
    queryKey: ["movements", productId],
    queryFn: () => apiFetch<HistoryResult>("/api/v1/inventory/products/" + productId + "/movements"),
    retry: false,
  });

  async function recordMovement(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    const delta = Number(qty);
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
            productId,
            type,
            qtyDelta: delta,
            reason: reason.trim() ? reason.trim() : undefined,
          }),
        },
      });
      setQty("");
      setReason("");
      await historyQuery.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.code + ": " + err.message : "Record failed");
    }
  }

  if (historyQuery.isLoading) return <main>Loading movements…</main>;
  if (historyQuery.isError || !historyQuery.data)
    return (
      <main>
        <p role="alert">Movement history not found.</p>
        <Link href="/inventory">Back to inventory</Link>
      </main>
    );

  const data = historyQuery.data;
  const role = meQuery.data?.role ?? "cashier";
  const adjustable = canAdjustInventory(role);

  return (
    <main>
      <Link href="/inventory">Back to inventory</Link>
      <h1>Movement history</h1>
      <p>
        {data.total} movement{data.total === 1 ? "" : "s"} — newest first
      </p>
      <ul>
        {data.items.map((m) => (
          <li key={m.id}>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {m.qtyDelta > 0 ? "+" + m.qtyDelta : m.qtyDelta}
            </span>{" "}
            {m.type}
            {m.reason ? " — " + m.reason : ""}
          </li>
        ))}
      </ul>
      {adjustable && (
        <section>
          <h2>Record movement</h2>
          <form onSubmit={(e) => void recordMovement(e)}>
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
              <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="10 or -2" inputMode="numeric" />
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
