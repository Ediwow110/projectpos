"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../../lib/api";
import { BarChart } from "../../../lib/charts";
import { money } from "../../../lib/reports";

interface ProductRow {
  productId: string;
  name: string;
  qty: number;
  revenue: number;
  profit: number | null;
  marginPct: number | null;
}

export default function ProductsReportPage(): JSX.Element {
  const [tab, setTab] = useState("top");
  const query = useQuery({
    queryKey: ["report-products", tab],
    queryFn: () =>
      apiFetch<{ rows: ProductRow[] }>(
        `/api/v1/reports/products?compare=none&tab=${tab}&limit=20`,
      ),
    retry: false,
  });

  return (
    <main>
      <Link href="/">Back to dashboard</Link>
      <h1>Products report</h1>
      <label>
        View
        <select value={tab} onChange={(e) => setTab(e.target.value)}>
          <option value="top">Top sellers</option>
          <option value="slow">Slow (no sales in range)</option>
          <option value="dead">Dead (no sales in 90 days)</option>
        </select>
      </label>
      {query.isLoading && <p>Loading…</p>}
      {query.isError && (
        <p role="alert">
          {query.error instanceof ApiError ? query.error.code + ": " + query.error.message : "Could not load report."}
        </p>
      )}
      {query.data && (
        <>
          <BarChart bars={query.data.rows.map((r) => ({ label: r.name, value: r.revenue }))} />
          <table>
            <thead><tr><th>Product</th><th>Qty</th><th>Revenue</th><th>Profit</th><th>Margin</th></tr></thead>
            <tbody>
              {query.data.rows.map((r) => (
                <tr key={r.productId} style={{ fontVariantNumeric: "tabular-nums" }}>
                  <td>{r.name}</td><td>{r.qty}</td><td>{money(r.revenue)}</td>
                  <td>{r.profit === null ? "—" : money(r.profit)}</td>
                  <td>{r.marginPct === null ? "—" : `${r.marginPct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
