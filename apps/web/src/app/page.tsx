"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../lib/api";
import { TrendChart } from "../lib/charts";
import { availableMetrics, buildOverviewQuery, formatDelta, money } from "../lib/reports";

interface Me {
  userId: string;
  businessId: string;
  businessName: string;
  role: string;
}

interface Kpi {
  value: number;
  previous: number | null;
  deltaMinor: number | null;
  deltaPct: number | null;
}

interface Overview {
  kpis: {
    netRevenue: Kpi;
    orders: Kpi;
    avgOrder: Kpi;
    grossProfit?: Kpi;
    refundTotal: Kpi;
    discountTotal: Kpi;
    expenseTotal: Kpi;
  };
  series: Array<{ bucket: string; netRevenue: number; orders: number }>;
  topProducts: Array<{ productId: string; name: string; qty: number; revenue: number }>;
  attention: Array<{ kind: string; label: string; href: string; count: number }>;
  compareLabel: string;
}

const PRESETS: Array<{ label: string; days: number | null }> = [
  { label: "Today", days: 0 },
  { label: "Yesterday", days: -1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

function presetRange(days: number | null): { dateFrom?: string; dateTo?: string } {
  if (days === null) return {};
  const now = new Date();
  if (days === 0) {
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    return { dateFrom: start.toISOString() };
  }
  if (days === -1) {
    const end = new Date(now);
    end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end.getTime() - 24 * 3600 * 1000);
    return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
  }
  return { dateFrom: new Date(now.getTime() - days * 24 * 3600 * 1000).toISOString() };
}

export default function DashboardPage(): JSX.Element {
  const [preset, setPreset] = useState(30);
  const [compare, setCompare] = useState("previous_period");
  const [metric, setMetric] = useState("revenue");

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<Me>("/api/v1/me"),
    retry: false,
  });

  const range = presetRange(preset);
  const overviewQuery = useQuery({
    queryKey: ["overview", preset, compare],
    queryFn: () =>
      apiFetch<Overview>(buildOverviewQuery({ ...range, compare })),
    retry: false,
    enabled: !meQuery.isError,
  });

  if (meQuery.isLoading) return <main>Loading…</main>;
  if (meQuery.isError)
    return (
      <main>
        <h1>Sign in required</h1>
        <Link href="/login">Go to sign in</Link>
      </main>
    );

  const data = overviewQuery.data;
  const metrics = data ? availableMetrics(data.kpis as Record<string, unknown>) : [];
  const showMetric = metrics.includes(metric) ? metric : "revenue";
  const seriesValue = (s: { bucket: string; netRevenue: number; orders: number }): number =>
    showMetric === "orders" ? s.orders : s.netRevenue;

  const hasData = (data?.kpis.orders.value ?? 0) > 0;

  return (
    <main>
      <h1>{meQuery.data!.businessName}</h1>
      <p>Signed in as {meQuery.data!.role}</p>
      <div>
        <label>
          Range
          <select value={preset} onChange={(e) => setPreset(Number(e.target.value))}>
            {PRESETS.map((p) => (
              <option key={p.label} value={p.days ?? -999}>{p.label}</option>
            ))}
          </select>
        </label>
        <label>
          Compare
          <select value={compare} onChange={(e) => setCompare(e.target.value)}>
            <option value="previous_period">Previous period</option>
            <option value="previous_year">Previous year</option>
            <option value="none">None</option>
          </select>
        </label>
        <nav aria-label="Reports">
          <Link href="/reports/sales">Sales</Link> | <Link href="/reports/products">Products</Link> |{" "}
          <Link href="/reports/inventory">Inventory</Link> | <Link href="/reports/payments">Payments</Link> |{" "}
          <Link href="/reports/cash">Cash</Link> | <Link href="/reports/customers">Customers</Link> |{" "}
          <Link href="/reports/cashiers">Cashiers</Link>
        </nav>
      </div>
      {overviewQuery.isLoading && <p>Loading dashboard…</p>}
      {overviewQuery.isError && (
        <p role="alert">
          {overviewQuery.error instanceof ApiError
            ? overviewQuery.error.code + ": " + overviewQuery.error.message
            : "Could not load dashboard."}
        </p>
      )}
      {data && !hasData && (
        <section>
          <h2>Getting started</h2>
          <ul>
            <li><Link href="/onboarding">Continue setup</Link></li>
            <li><Link href="/products">Products</Link></li>
            <li><Link href="/inventory">Inventory</Link></li>
            <li><Link href="/pos">Point of sale</Link></li>
            <li><Link href="/registers">Registers</Link></li>
            <li><Link href="/shifts">Shifts</Link></li>
            <li><Link href="/sales">Sales</Link></li>
            <li><Link href="/customers">Customers</Link></li>
            <li><Link href="/expenses">Expenses</Link></li>
            <li>Team — coming in a later phase</li>
          </ul>
        </section>
      )}
      {data && hasData && (
        <>
          <section aria-label="Key metrics">
            <h2>Key metrics</h2>
            <ul>
              <li>
                <Link href="/sales">
                  Revenue: <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(data.kpis.netRevenue.value)}</span>
                </Link>{" "}
                {data.kpis.netRevenue.deltaMinor !== null && (
                  <span>{formatDelta({ deltaMinor: data.kpis.netRevenue.deltaMinor, deltaPct: data.kpis.netRevenue.deltaPct }, data.compareLabel)}</span>
                )}
              </li>
              <li>
                <Link href="/sales">
                  Orders: <span style={{ fontVariantNumeric: "tabular-nums" }}>{data.kpis.orders.value}</span>
                </Link>
              </li>
              <li>
                Avg order: <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(Math.round(data.kpis.avgOrder.value))}</span>
              </li>
              {data.kpis.grossProfit && (
                <li>
                  Profit: <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(data.kpis.grossProfit.value)}</span>
                </li>
              )}
              <li>
                <Link href="/sales?status=REFUNDED">Refunds: {money(data.kpis.refundTotal.value)}</Link>
              </li>
            </ul>
          </section>
          <section aria-label="Sales trend">
            <h2>Sales trend</h2>
            <label>
              Metric
              <select value={showMetric} onChange={(e) => setMetric(e.target.value)}>
                {metrics.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
            <TrendChart
              points={data.series.map((s) => ({ bucket: s.bucket, value: seriesValue(s) }))}
              label={`Sales trend by ${showMetric}`}
            />
            <table>
              <thead><tr><th>Date</th><th>{showMetric}</th></tr></thead>
              <tbody>
                {data.series.map((s) => (
                  <tr key={s.bucket} style={{ fontVariantNumeric: "tabular-nums" }}>
                    <td>{s.bucket}</td><td>{seriesValue(s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section aria-label="Top products">
            <h2>Top products</h2>
            <table>
              <thead><tr><th>Product</th><th>Qty</th><th>Revenue</th></tr></thead>
              <tbody>
                {data.topProducts.map((p) => (
                  <tr key={p.productId} style={{ fontVariantNumeric: "tabular-nums" }}>
                    <td>{p.name}</td><td>{p.qty}</td><td>{money(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Link href="/reports/products">All products</Link>
          </section>
          <section aria-label="Needs attention">
            <h2>Needs attention</h2>
            {data.attention.length === 0 && <p>Nothing needs attention right now.</p>}
            <ul>
              {data.attention.map((a) => (
                <li key={a.kind}>
                  <Link href={a.href}>{a.label}</Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
