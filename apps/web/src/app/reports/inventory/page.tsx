"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../../lib/api";

interface InventoryPayload {
  healthy: number;
  low: number;
  out: number;
  untracked: number;
  lowStock: Array<{ productId: string; name: string; onHand: number; reorderLevel: number }>;
  movements: { received: number; sold: number; damaged: number; adjusted: number };
}

export default function InventoryReportPage(): JSX.Element {
  const query = useQuery({
    queryKey: ["report-inventory"],
    queryFn: () => apiFetch<InventoryPayload>("/api/v1/reports/inventory"),
    retry: false,
  });

  return (
    <main>
      <Link href="/">Back to dashboard</Link>
      <h1>Inventory report</h1>
      {query.isLoading && <p>Loading…</p>}
      {query.isError && (
        <p role="alert">
          {query.error instanceof ApiError ? query.error.code + ": " + query.error.message : "Could not load report."}
        </p>
      )}
      {query.data && (
        <>
          <dl style={{ fontVariantNumeric: "tabular-nums" }}>
            <div><dt>Healthy</dt><dd>{query.data.healthy}</dd></div>
            <div><dt>Low</dt><dd>{query.data.low}</dd></div>
            <div><dt>Out of stock</dt><dd>{query.data.out}</dd></div>
            <div><dt>Untracked</dt><dd>{query.data.untracked}</dd></div>
            <div><dt>Received (all time)</dt><dd>{query.data.movements.received}</dd></div>
            <div><dt>Sold (all time)</dt><dd>{query.data.movements.sold}</dd></div>
            <div><dt>Damaged (all time)</dt><dd>{query.data.movements.damaged}</dd></div>
            <div><dt>Adjusted (all time)</dt><dd>{query.data.movements.adjusted}</dd></div>
          </dl>
          <h2>Low and out of stock</h2>
          {query.data.lowStock.length === 0 && <p>Stock levels are healthy.</p>}
          <ul>
            {query.data.lowStock.map((p) => (
              <li key={p.productId} style={{ fontVariantNumeric: "tabular-nums" }}>
                {p.name} — on hand {p.onHand}, reorder at {p.reorderLevel}
              </li>
            ))}
          </ul>
          <Link href="/inventory">Open inventory</Link>
        </>
      )}
    </main>
  );
}
