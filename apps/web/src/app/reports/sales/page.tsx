"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../../components/AppShell";
import { MetricCard, PageHeader, Panel, SectionHeader } from "../../../components/premium";
import { StatusPill } from "../../../components/ui";
import { apiFetch } from "../../../lib/api";
import { RequestError } from "../../../lib/billing-ui";
import { DonutChart, HorizontalBarChart, VerticalBarChart } from "../../../lib/charts";
import { formatMoneyMinor } from "../../../lib/money";
import { branchShares, paymentMix, reportSeries } from "../../../lib/report-view";

interface SalesPayload {
  totals: {
    netRevenue: number;
    orders: number;
    avgOrder: number;
    grossProfit: number | null;
    refundTotal: number;
    discountTotal: number;
  };
  series: Array<{ bucket: string; netRevenue: number; orders: number }>;
  compareLabel: string;
}

interface PaymentsPayload {
  byMethod: Array<{ method: string; total: number; count: number }>;
  unknown: number;
  refunded: number;
}

interface ProductReportRow {
  productId: string;
  name: string;
  qty: number;
  revenue: number;
  profit: number | null;
  marginPct: number | null;
}

interface BranchReportRow {
  branchId: string | null;
  name: string;
  type: string;
  sales: number;
  orders: number;
  margin: number | null;
}

interface Me {
  role: string;
  businessName?: string;
}

function money(minor: number): string {
  return formatMoneyMinor(minor);
}

const REPORT_LINKS = [
  ["Sales", "/reports/sales"],
  ["Products", "/reports/products"],
  ["Inventory", "/reports/inventory"],
  ["Payments", "/reports/payments"],
  ["Cash", "/reports/cash"],
  ["Branches", "/reports/branches"],
] as const;

export default function SalesReportPage(): JSX.Element {
  const [granularity, setGranularity] = useState<"day" | "hour">("day");
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<Me>("/api/v1/me"),
    retry: false,
  });
  const salesQuery = useQuery({
    queryKey: ["report-sales", granularity],
    queryFn: () =>
      apiFetch<SalesPayload>(
        "/api/v1/reports/sales?compare=previous_period&granularity=" + granularity,
      ),
    retry: false,
  });
  const paymentsQuery = useQuery({
    queryKey: ["report-payments-overview"],
    queryFn: () => apiFetch<PaymentsPayload>("/api/v1/reports/payments?compare=none"),
    retry: false,
  });
  const productsQuery = useQuery({
    queryKey: ["report-products-overview"],
    queryFn: () =>
      apiFetch<{ rows: ProductReportRow[] }>(
        "/api/v1/reports/products?compare=none&tab=top&limit=8",
      ),
    retry: false,
  });
  const branchesQuery = useQuery({
    queryKey: ["report-branches-overview"],
    queryFn: () =>
      apiFetch<{ rows: BranchReportRow[]; compareLabel: string }>(
        "/api/v1/reports/branches?compare=none",
      ),
    retry: false,
  });

  const sales = salesQuery.data;
  const mix = paymentMix(paymentsQuery.data?.byMethod ?? []);
  const branches = branchShares(
    (branchesQuery.data?.rows ?? []).map((row) => ({
      name: row.name,
      sales: row.sales,
      orders: row.orders,
    })),
  );
  const leadingPayment = mix[0];

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Analytics / Reporting"
          title="Reports intelligence"
          description="Compare periods, understand payment and product performance, and trace every summary back to a dedicated source report."
          actions={
            <label className="text-[11px] font-semibold text-[#655b53]">
              Granularity
              <select
                value={granularity}
                onChange={(event) => setGranularity(event.target.value as "day" | "hour")}
                className="field ml-2 !w-auto !py-2 text-xs"
              >
                <option value="day">Day</option>
                <option value="hour">Hour</option>
              </select>
            </label>
          }
        />

        <nav aria-label="Report sections" className="flex flex-wrap gap-2">
          {REPORT_LINKS.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              aria-current={href === "/reports/sales" ? "page" : undefined}
              className={
                "rounded-full px-3 py-2 text-[11px] font-semibold " +
                (href === "/reports/sales"
                  ? "bg-[#fff0ea] text-[var(--color-atlas-accent-strong)]"
                  : "border border-[#e4d9d0] bg-white text-[#73685f] hover:border-[#f35d3f]")
              }
            >
              {label}
            </Link>
          ))}
        </nav>

        {salesQuery.isLoading ? (
          <Panel className="p-6 text-sm text-[#73685f]">Loading sales report…</Panel>
        ) : null}
        <RequestError
          error={salesQuery.isError ? salesQuery.error : null}
          fallback="Could not load sales report."
        />

        {sales ? (
          <>
            <section aria-label="Report summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Net revenue"
                value={"₱" + money(sales.totals.netRevenue)}
                icon="↗"
                meta={sales.compareLabel}
              />
              <MetricCard
                label="Orders"
                value={sales.totals.orders.toLocaleString("en-PH")}
                icon="▣"
                tone="info"
                meta="Recorded order count"
              />
              <MetricCard
                label="Average order"
                value={"₱" + money(sales.totals.avgOrder)}
                icon="○"
                meta="Net revenue / orders"
              />
              <MetricCard
                label="Gross profit"
                value={sales.totals.grossProfit === null ? "Unavailable" : "₱" + money(sales.totals.grossProfit)}
                icon="◇"
                tone={sales.totals.grossProfit === null ? "warning" : "success"}
                meta={sales.totals.grossProfit === null ? "Not returned for this role/report" : "Permission-aware value"}
              />
            </section>

            <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
              <Panel className="p-5">
                <SectionHeader
                  title="Revenue trend"
                  description={"Net revenue by " + granularity + ". The chart uses the report endpoint directly."}
                />
                <div className="mt-4">
                  <VerticalBarChart
                    label="Net revenue trend"
                    bars={reportSeries(sales.series, "revenue").map((point) => ({
                      label: granularity === "day" ? point.label.slice(5) : point.label.slice(11, 16),
                      value: point.value,
                    }))}
                    height={230}
                  />
                </div>
              </Panel>

              <Panel className="p-5">
                <SectionHeader title="Payment mix" description="Share of recorded payment value by rail." />
                {paymentsQuery.isLoading ? <p className="mt-4 text-sm text-[#73685f]">Loading payment mix…</p> : null}
                {paymentsQuery.isError ? <p role="alert" className="mt-4 text-sm text-[#c43e3e]">Could not load payment mix.</p> : null}
                {mix.length > 0 ? (
                  <div className="mt-3 grid grid-cols-[170px_1fr] items-center">
                    <DonutChart
                      label="Payment mix"
                      segments={mix.map((item) => ({ label: item.label, value: item.value }))}
                      centerLabel={leadingPayment ? leadingPayment.sharePct + "%" : undefined}
                    />
                    <ul className="space-y-2">
                      {mix.slice(0, 5).map((item) => (
                        <li key={item.label} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="font-semibold text-[#2a241f]">{item.label}</span>
                          <span className="font-data text-[#73685f]">{item.sharePct}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : !paymentsQuery.isLoading ? <p className="mt-5 text-sm text-[var(--color-atlas-muted-strong)]">No payment data available.</p> : null}
                {paymentsQuery.data?.unknown ? (
                  <div className="mt-3">
                    <StatusPill tone="warn">{paymentsQuery.data.unknown} payment(s) need reconciliation</StatusPill>
                  </div>
                ) : null}
              </Panel>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Panel className="p-5">
                <SectionHeader
                  title="Top product performance"
                  description="Revenue from the top-products report. No category contribution is fabricated."
                  action={<Link href="/reports/products" className="text-[11px] font-semibold text-[var(--color-atlas-accent-strong)]">Open product report →</Link>}
                />
                <div className="mt-5">
                  {productsQuery.isLoading ? <p className="text-sm text-[#73685f]">Loading products…</p> : null}
                  {productsQuery.isError ? <p role="alert" className="text-sm text-[#c43e3e]">Could not load product report.</p> : null}
                  {productsQuery.data ? (
                    <HorizontalBarChart
                      label="Top product revenue"
                      bars={productsQuery.data.rows.slice(0, 6).map((row) => ({
                        label: row.name,
                        value: row.revenue,
                      }))}
                    />
                  ) : null}
                </div>
              </Panel>

              <Panel className="p-5">
                <SectionHeader
                  title="Branch comparison"
                  description="Sales share across branch-report rows."
                  action={<Link href="/reports/branches" className="text-[11px] font-semibold text-[var(--color-atlas-accent-strong)]">Open branch report →</Link>}
                />
                <div className="mt-5">
                  {branchesQuery.isLoading ? <p className="text-sm text-[#73685f]">Loading branches…</p> : null}
                  {branchesQuery.isError ? <p role="alert" className="text-sm text-[#c43e3e]">Could not load branch comparison.</p> : null}
                  {branchesQuery.data ? (
                    <HorizontalBarChart
                      label="Branch sales"
                      bars={branches.slice(0, 6).map((row) => ({
                        label: row.label,
                        value: row.sales,
                      }))}
                    />
                  ) : null}
                </div>
              </Panel>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
              <Panel className="p-5">
                <SectionHeader title="Orders" description="Order count by the same authoritative report buckets." />
                <div className="mt-4">
                  <VerticalBarChart
                    label="Order volume"
                    bars={reportSeries(sales.series, "orders").map((point) => ({
                      label: granularity === "day" ? point.label.slice(5) : point.label.slice(11, 16),
                      value: point.value,
                      color: "#3468d4",
                    }))}
                    height={190}
                  />
                </div>
              </Panel>

              <Panel className="p-5">
                <SectionHeader title="Exceptions" description="Recorded refund and discount totals in this report." />
                <dl className="mt-4 space-y-3">
                  <div className="flex items-center justify-between rounded-xl bg-[#fcf8f3] p-3">
                    <dt className="text-[11px] text-[#73685f]">Refund total</dt>
                    <dd className="font-data text-sm font-semibold">₱{money(sales.totals.refundTotal)}</dd>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-[#fcf8f3] p-3">
                    <dt className="text-[11px] text-[#73685f]">Discount total</dt>
                    <dd className="font-data text-sm font-semibold">₱{money(sales.totals.discountTotal)}</dd>
                  </div>
                  <Link href="/sales" className="mt-2 inline-flex text-[11px] font-semibold text-[var(--color-atlas-accent-strong)]">Drill into source transactions →</Link>
                </dl>
              </Panel>
            </div>
          </>
        ) : null}
      </main>
    </AppShell>
  );
}
