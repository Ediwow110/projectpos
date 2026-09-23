"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../../lib/api";
import { TrendChart } from "../../../lib/charts";
import { money } from "../../../lib/reports";

interface SalesPayload {
  totals: { netRevenue: number; orders: number; avgOrder: number; grossProfit: number | null; refundTotal: number; discountTotal: number };
  series: Array<{ bucket: string; netRevenue: number; orders: number }>;
  compareLabel: string;
}

export default function SalesReportPage(): JSX.Element {
  const [granularity, setGranularity] = useState("day");
  const query = useQuery({
    queryKey: ["report-sales", granularity],
    queryFn: () =>
      apiFetch<SalesPayload>(
        `/api/v1/reports/sales?compare=previous_period&granularity=${granularity}`,
      ),
    retry: false,
  });

  return (
    <main>
      <Link href="/">Back to dashboard</Link>
      <h1>Sales report</h1>
      <label>
        Granularity
        <select value={granularity} onChange={(e) => setGranularity(e.target.value)}>
          <option value="day">Day</option>
          <option value="hour">Hour</option>
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
          <dl style={{ fontVariantNumeric: "tabular-nums" }}>
            <div><dt>Net revenue</dt><dd>{money(query.data.totals.netRevenue)}</dd></div>
            <div><dt>Orders</dt><dd>{query.data.totals.orders}</dd></div>
            <div><dt>Refunds</dt><dd>{money(query.data.totals.refundTotal)}</dd></div>
            <div><dt>Discounts</dt><dd>{money(query.data.totals.discountTotal)}</dd></div>
            {query.data.totals.grossProfit !== null && (
              <div><dt>Gross profit</dt><dd>{money(query.data.totals.grossProfit)}</dd></div>
            )}
          </dl>
          <p>{query.data.compareLabel}</p>
          <TrendChart
            points={query.data.series.map((s) => ({ bucket: s.bucket, value: s.netRevenue }))}
            label="Net revenue trend"
          />
          <table>
            <thead><tr><th>Bucket</th><th>Revenue</th><th>Orders</th></tr></thead>
            <tbody>
              {query.data.series.map((s) => (
                <tr key={s.bucket} style={{ fontVariantNumeric: "tabular-nums" }}>
                  <td>{s.bucket}</td><td>{money(s.netRevenue)}</td><td>{s.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Link href="/sales">Drill into sales history</Link>
        </>
      )}
    </main>
  );
}
