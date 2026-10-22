"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
import { ApiError, apiFetch } from "../../lib/api";
import { errorText } from "../../lib/billing";
import { canExport as canExportCsv } from "../../lib/exports";
import { salesExportUrl } from "../../lib/sales-export";
import { DonutChart, HorizontalBarChart, VerticalBarChart } from "../../lib/charts";
import { formatMoneyMinor } from "../../lib/money";
import { paymentMix, reportSeries } from "../../lib/report-view";

interface Me {
  role: string;
  businessName?: string;
  permissions?: string[];
}

interface SaleRow {
  id: string;
  receiptNo: string;
  status: string;
  totalMinor: number;
  customerName: string | null;
  branchId: string | null;
}

interface BranchRow {
  id: string;
  name: string;
}

interface SalesPage {
  items: SaleRow[];
  nextCursor: string | null;
}

interface SalesSummaryPayload {
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

function money(minor: number): string {
  return formatMoneyMinor(minor);
}

function statusTone(status: string): "ok" | "warn" | "bad" | "info" {
  if (status === "COMPLETED") return "ok";
  if (status === "REFUNDED" || status === "VOIDED") return "bad";
  if (status === "REFUND_REQUESTED") return "warn";
  return "info";
}

export default function SalesHistoryPage(): JSX.Element {
  const [status, setStatus] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [branchId, setBranchId] = useState("");
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [error, setError] = useState("");

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiFetch<{ items: BranchRow[] }>("/api/v1/branches"),
    retry: false,
  });
  const summaryQuery = useQuery({
    queryKey: ["sales-summary"],
    queryFn: () => apiFetch<SalesSummaryPayload>("/api/v1/reports/sales?compare=previous_period&granularity=day"),
    retry: false,
  });
  const paymentsQuery = useQuery({
    queryKey: ["sales-payment-mix"],
    queryFn: () => apiFetch<PaymentsPayload>("/api/v1/reports/payments?compare=none"),
    retry: false,
  });
  const hourlyQuery = useQuery({
    queryKey: ["sales-hourly"],
    queryFn: () => apiFetch<SalesSummaryPayload>("/api/v1/reports/sales?compare=none&granularity=hour"),
    retry: false,
  });
  const productsQuery = useQuery({
    queryKey: ["sales-top-products"],
    queryFn: () =>
      apiFetch<{ rows: ProductReportRow[] }>(
        "/api/v1/reports/products?compare=none&tab=top&limit=6",
      ),
    retry: false,
  });

  function queryString(next?: string): string {
    const sp = new URLSearchParams();
    sp.set("limit", "20");
    if (status !== "") sp.set("status", status);
    if (customerId.trim() !== "") sp.set("customerId", customerId.trim());
    if (dateFrom !== "") sp.set("dateFrom", dateFrom);
    if (dateTo !== "") sp.set("dateTo", dateTo);
    if (next) sp.set("cursor", next);
    return "/api/v1/sales?" + sp.toString();
  }

  const listQuery = useQuery({
    queryKey: ["sales", status, customerId, dateFrom, dateTo, cursor],
    queryFn: () => apiFetch<SalesPage>(queryString(cursor)),
    retry: false,
  });

  const branchName = (id: string | null): string =>
    id == null ? "No branch" : branchesQuery.data?.items.find((branch) => branch.id === id)?.name ?? "Unknown branch";
  const visibleSales = (listQuery.data?.items ?? []).filter(
    (sale) => branchId === "" || (sale.branchId ?? null) === branchId,
  );

  async function downloadExport(): Promise<void> {
    setError("");
    try {
      const response = await fetch(salesExportUrl({ status, customerId, dateFrom, dateTo }), { credentials: "include" });
      if (!response.ok) {
        const envelope = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
        throw new ApiError(envelope?.code ?? "HTTP_ERROR", envelope?.message ?? "Export failed", response.headers.get("x-correlation-id") ?? "", response.status);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "sales-export.csv";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(errorText(cause, "The sales export could not be downloaded."));
    }
  }

  const role = meQuery.data?.role ?? "cashier";
  const canExport = canExportCsv(meQuery.data?.permissions ?? []);
  const summary = summaryQuery.data;
  const mix = paymentMix(paymentsQuery.data?.byMethod ?? []);
  const leadingMix = mix[0];

  return (
    <AppShell businessName={meQuery.data?.businessName} role={role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Sales / Transactions"
          title="Sales intelligence"
          description="Review transaction history with real sales momentum and payment-mix context above the source records."
          actions={canExport ? <GhostButton type="button" onClick={() => void downloadExport()}>⇩ Export CSV</GhostButton> : undefined}
        />

        {summary ? (
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Sales summary">
            <MetricCard label="Net sales" value={"₱" + money(summary.totals.netRevenue)} icon="↗" meta={summary.compareLabel} />
            <MetricCard label="Orders" value={summary.totals.orders.toLocaleString("en-PH")} icon="▣" tone="info" meta="Completed order volume" />
            <MetricCard label="Average order" value={"₱" + money(summary.totals.avgOrder)} icon="○" meta="Net revenue / orders" />
            <MetricCard label="Refunds" value={"₱" + money(summary.totals.refundTotal)} icon="↺" tone={summary.totals.refundTotal > 0 ? "warning" : "success"} meta="Refund total in selected report range" />
          </section>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
          <Panel className="p-5">
            <SectionHeader title="Sales momentum" description="Net revenue by report bucket. Values come directly from the sales report endpoint." />
            <div className="mt-4">
              {summaryQuery.isLoading ? <p className="text-sm text-[#73685f]">Loading sales trend…</p> : null}
              {summaryQuery.isError ? <p role="alert" className="text-sm text-[#c43e3e]">Could not load sales trend.</p> : null}
              {summary ? (
                <VerticalBarChart
                  label="Net revenue trend"
                  bars={reportSeries(summary.series, "revenue").map((point) => ({ label: point.label.slice(5), value: point.value }))}
                  height={220}
                />
              ) : null}
            </div>
          </Panel>

          <Panel className="p-5">
            <SectionHeader title="Payment mix" description="Share of recorded payment value by method." />
            {paymentsQuery.isLoading ? <p className="mt-4 text-sm text-[#73685f]">Loading payment mix…</p> : null}
            {paymentsQuery.isError ? <p role="alert" className="mt-4 text-sm text-[#c43e3e]">Could not load payment mix.</p> : null}
            {mix.length > 0 ? (
              <div className="mt-3 grid grid-cols-[170px_1fr] items-center gap-2">
                <DonutChart
                  label="Payment mix"
                  segments={mix.map((item) => ({ label: item.label, value: item.value }))}
                  centerLabel={leadingMix ? leadingMix.sharePct + "%" : undefined}
                />
                <ul className="space-y-2">
                  {mix.slice(0, 5).map((item) => (
                    <li key={item.label} className="flex items-center justify-between gap-3 text-[11px]">
                      <span className="font-semibold text-[#2a241f]">{item.label}</span>
                      <span className="font-data text-[#73685f]">{item.sharePct}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : !paymentsQuery.isLoading ? <p className="mt-5 text-sm text-[var(--color-atlas-muted-strong)]">No payment data available.</p> : null}
          </Panel>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <Panel className="p-5">
            <SectionHeader title="Top product performance" description="Revenue contribution from the authoritative top-products report." />
            <div className="mt-5">
              {productsQuery.isLoading ? <p className="text-sm text-[#73685f]">Loading product performance…</p> : null}
              {productsQuery.isError ? <p role="alert" className="text-sm text-[#c43e3e]">Could not load product performance.</p> : null}
              {productsQuery.data ? (
                <HorizontalBarChart
                  label="Top product revenue"
                  bars={productsQuery.data.rows.slice(0, 5).map((row) => ({
                    label: row.name,
                    value: row.revenue,
                  }))}
                  width={420}
                />
              ) : null}
            </div>
          </Panel>

          <Panel className="p-5">
            <SectionHeader title="Orders by hour" description="Recent hourly order volume from the sales report endpoint." />
            <div className="mt-4">
              {hourlyQuery.isLoading ? <p className="text-sm text-[#73685f]">Loading hourly orders…</p> : null}
              {hourlyQuery.isError ? <p role="alert" className="text-sm text-[#c43e3e]">Could not load hourly orders.</p> : null}
              {hourlyQuery.data ? (
                <VerticalBarChart
                  label="Hourly order volume"
                  bars={reportSeries(hourlyQuery.data.series, "orders").slice(-12).map((point) => ({
                    label: point.label.includes("T") ? point.label.slice(11, 16) : point.label.slice(-5),
                    value: point.value,
                    color: "#f35d3f",
                  }))}
                  width={420}
                  height={190}
                />
              ) : null}
            </div>
          </Panel>

          <Panel className="p-5">
            <SectionHeader title="Refunds & discounts" description="Recorded exception totals for the same report range." />
            <div className="mt-4">
              {summary ? (
                <VerticalBarChart
                  label="Refund and discount totals"
                  bars={[
                    { label: "Refunds", value: summary.totals.refundTotal, color: "#c43e3e" },
                    { label: "Discounts", value: summary.totals.discountTotal, color: "#d8cdc3" },
                  ]}
                  width={420}
                  height={190}
                />
              ) : null}
            </div>
          </Panel>
        </div>

        <Panel className="p-5">
          <SectionHeader title="Transaction filters" description="Filter the source records without changing the summary graphs above." />
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              setCursor(undefined);
              void listQuery.refetch();
            }}
            className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto]"
          >
            <label className="text-[11px] font-semibold text-[#655b53]">
              Status
              <select value={status} onChange={(event) => setStatus(event.target.value)} className="field mt-1.5">
                <option value="">All</option>
                <option value="COMPLETED">Completed</option>
                <option value="PARTIALLY_REFUNDED">Partially refunded</option>
                <option value="REFUNDED">Refunded</option>
                <option value="REFUND_REQUESTED">Refund requested</option>
                <option value="VOIDED">Voided</option>
              </select>
            </label>
            <label className="text-[11px] font-semibold text-[#655b53]">
              Customer ID
              <input value={customerId} onChange={(event) => setCustomerId(event.target.value)} placeholder="Optional" className="field mt-1.5" />
            </label>
            <label className="text-[11px] font-semibold text-[#655b53]">
              From
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="field mt-1.5" />
            </label>
            <label className="text-[11px] font-semibold text-[#655b53]">
              To
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="field mt-1.5" />
            </label>
            <label className="text-[11px] font-semibold text-[#655b53]">
              Branch
              <select value={branchId} onChange={(event) => setBranchId(event.target.value)} className="field mt-1.5">
                <option value="">All branches</option>
                {(branchesQuery.data?.items ?? []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>
            <PrimaryButton type="submit" className="self-end">Apply</PrimaryButton>
          </form>
        </Panel>

        <DataTableFrame>
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            <div>
              <h2 className="font-display text-base font-semibold">Transactions</h2>
              <p className="mt-1 text-[11px] text-[#7a6f66]">Source records remain the authoritative drill-down.</p>
            </div>
            <Link href="/reports/sales" className="text-[11px] font-semibold text-[var(--color-atlas-accent-strong)]">Open reports →</Link>
          </div>
          {listQuery.isLoading ? <p className="px-5 pb-5 text-sm text-[#73685f]">Loading sales…</p> : null}
          {listQuery.isError ? (
            <p role="alert" className="mx-5 mb-5 rounded-xl bg-[#fff0f0] px-3 py-2 text-sm font-medium text-[#c43e3e]">
              {listQuery.error instanceof ApiError ? listQuery.error.code + ": " + listQuery.error.message : "Could not load sales."}
            </p>
          ) : null}
          {listQuery.data && visibleSales.length === 0 ? <p className="px-5 pb-6 text-sm text-[var(--color-atlas-muted-strong)]">No sales match these filters.</p> : null}
          {visibleSales.length > 0 ? (
            <table className="premium-table min-w-[900px] text-left text-[12px]">
              <thead>
                <tr>
                  <th className="px-5 pb-3">Receipt</th>
                  <th className="px-5 pb-3">Customer</th>
                  <th className="px-5 pb-3">Branch</th>
                  <th className="px-5 pb-3 text-right">Net total</th>
                  <th className="px-5 pb-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleSales.map((sale) => (
                  <tr key={sale.id}>
                    <td className="px-5 py-3"><Link href={"/sales/" + sale.id} className="font-data font-medium text-[#2a241f] hover:text-[var(--color-atlas-accent-strong)]">{sale.receiptNo}</Link></td>
                    <td className="px-5 py-3 text-[#73685f]">{sale.customerName ?? "Walk-in"}</td>
                    <td className="px-5 py-3 text-[#73685f]">{branchName(sale.branchId)}</td>
                    <td className="font-data px-5 py-3 text-right font-medium">₱{money(sale.totalMinor)}</td>
                    <td className="px-5 py-3 text-right"><StatusPill tone={statusTone(sale.status)}>{sale.status.replaceAll("_", " ")}</StatusPill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {listQuery.data?.nextCursor ? (
            <div className="flex justify-end border-t border-[#eee6de] px-5 py-4">
              <GhostButton type="button" onClick={() => setCursor(listQuery.data!.nextCursor!)}>Next page</GhostButton>
            </div>
          ) : null}
        </DataTableFrame>

        {paymentsQuery.data && paymentsQuery.data.unknown > 0 ? (
          <Panel className="border-[#efd6a5] bg-[#fff4df] p-4">
            <p className="text-sm font-semibold text-[#8a5606]">Payment reconciliation required: {paymentsQuery.data.unknown} unknown payment{paymentsQuery.data.unknown === 1 ? "" : "s"}.</p>
          </Panel>
        ) : null}
        {error !== "" ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2 text-sm font-medium text-[#c43e3e]">{error}</p> : null}
      </main>
    </AppShell>
  );
}
