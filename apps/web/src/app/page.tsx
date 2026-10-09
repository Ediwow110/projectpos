"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../components/AppShell";
import { NexposMark } from "../components/brand/NexposLogo";
import { MetricCard, PageHeader, Panel, SectionHeader } from "../components/premium";
import { Card, Delta, Peso, StatusPill } from "../components/ui";
import { ApiError, apiFetch } from "../lib/api";
import { errorText } from "../lib/billing";
import { attentionRows, dashboardKpi, dashboardSeries } from "../lib/dashboard-view";
import { VerticalBarChart } from "../lib/charts";
import { availableMetrics, buildOverviewQuery, money } from "../lib/reports";
import {
  IndexedDbSyncStore,
  clearActiveSyncScope,
  createActiveSyncStore,
  persistActiveSyncScope,
} from "../lib/sync-store";
import { ConnectivityBanner, SyncAttentionItems } from "../lib/sync-ui";
import { workspaceMeRetry, workspaceMeRetryDelay } from "../lib/workspace-me-retry";

interface Me {
  userId: string;
  businessId: string;
  businessName: string;
  role: string;
  activeBranchId: string | null;
  activeBranchName: string | null;
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

const PRESETS: Array<{ label: string; days: number }> = [
  { label: "Today", days: 0 },
  { label: "Yesterday", days: -1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

const KPI_META = [
  { key: "netRevenue", label: "Total sales", icon: "▥", tone: "coral" as const, money: true },
  { key: "orders", label: "Total orders", icon: "▣", tone: "coral" as const, money: false },
  { key: "avgOrder", label: "Average order", icon: "○", tone: "coral" as const, money: true },
  { key: "grossProfit", label: "Gross profit", icon: "◇", tone: "success" as const, money: true },
];

function presetRange(days: number): { dateFrom?: string; dateTo?: string } {
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

function daypart(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export default function DashboardPage(): JSX.Element {
  const router = useRouter();
  const [preset, setPreset] = useState(30);
  const [compare, setCompare] = useState("previous_period");
  const [metric, setMetric] = useState<"revenue" | "orders">("revenue");
  const [syncStore, setSyncStore] = useState<IndexedDbSyncStore | null>(() => createActiveSyncStore());

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<Me>("/api/v1/me"),
    retry: workspaceMeRetry,
    retryDelay: workspaceMeRetryDelay,
  });
  const unauthorized = meQuery.error instanceof ApiError && (meQuery.error.status === 401 || meQuery.error.status === 403);

  useEffect(() => {
    if (meQuery.data) {
      const scope = { userId: meQuery.data.userId, businessId: meQuery.data.businessId };
      persistActiveSyncScope(scope);
      setSyncStore((current) => current?.scope.userId === scope.userId && current.scope.businessId === scope.businessId
        ? current
        : new IndexedDbSyncStore(scope));
      return;
    }
    if (unauthorized) {
      clearActiveSyncScope();
      setSyncStore(null);
      router.replace("/login");
    }
  }, [meQuery.data, router, unauthorized]);
  const branchId = meQuery.data?.activeBranchId ?? "";
  const range = presetRange(preset);
  const overviewQuery = useQuery({
    queryKey: ["overview", preset, compare, branchId],
    queryFn: () => apiFetch<Overview>(buildOverviewQuery({ ...range, compare, branchId: branchId || undefined })),
    retry: false,
    enabled: !meQuery.isError,
  });

  if (meQuery.isLoading || unauthorized) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fcf8f3] p-8">
        <div className="flex items-center gap-3 text-sm text-[#73685f]">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#f35d3f] border-t-transparent" aria-hidden />
          {unauthorized ? "Redirecting to sign in…" : "Loading your business…"}
        </div>
      </main>
    );
  }

  if (meQuery.isError) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fcf8f3] p-8">
        <Card className="w-full max-w-md p-8 text-center">
          <NexposMark size={48} className="mx-auto" />
          <h1 className="font-display mt-4 text-xl font-bold">Could not load your workspace</h1>
          <p className="mt-1 text-sm text-[#73685f]">Check your connection and try again.</p>
          <button type="button" onClick={() => void meQuery.refetch()} className="mt-5 inline-flex w-full items-center justify-center rounded-[10px] bg-[#f35d3f] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#d94a30]">
            Try again
          </button>
        </Card>
      </main>
    );
  }

  const me = meQuery.data!;
  const data = overviewQuery.data;
  const available = data ? availableMetrics(data.kpis as Record<string, unknown>) : [];
  const activeMetric = available.includes(metric) ? metric : "revenue";
  const hasData = (data?.kpis.orders.value ?? 0) > 0;
  const attention = attentionRows(data?.attention ?? []);

  return (
    <AppShell businessName={me.businessName} role={me.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow={"Good " + daypart()}
          title="Dashboard"
          description="Here’s what’s happening with your store today. Monitor sales, inventory, and operations at a glance."
          actions={
            <>
              <select value={preset} onChange={(event) => setPreset(Number(event.target.value))} className="field !w-auto !py-2 text-xs font-semibold" aria-label="Range">
                {PRESETS.map((item) => <option key={item.label} value={item.days}>{item.label}</option>)}
              </select>
              <select value={compare} onChange={(event) => setCompare(event.target.value)} className="field !w-auto !py-2 text-xs font-semibold" aria-label="Compare">
                <option value="previous_period">Previous period</option>
                <option value="previous_year">Previous year</option>
                <option value="none">No comparison</option>
              </select>
            </>
          }
        />

        {syncStore ? <ConnectivityBanner store={syncStore} /> : null}

        {overviewQuery.isLoading ? <Panel className="p-6 text-sm text-[#73685f]">Loading dashboard…</Panel> : null}
        {overviewQuery.isError ? (
          <Panel className="border-[#efb9b9] bg-[#fff0f0] p-5">
            <p role="alert" className="text-sm font-medium text-[#9d3030]">
              {errorText(overviewQuery.error, "Could not load dashboard.")}
            </p>
          </Panel>
        ) : null}

        {data && !hasData ? (
          <Panel className="p-7">
            <SectionHeader title="Getting started" description="Set up your first sale in minutes, then the Dashboard will fill with live operating data." />
            <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
              {[
                ["Products", "/products"],
                ["Inventory", "/inventory"],
                ["Point of sale", "/pos"],
                ["Registers", "/registers"],
                ["Branches", "/branches"],
                ["Shifts", "/shifts"],
                ["Customers", "/customers"],
              ].map(([label, href]) => (
                <Link key={href} href={href} className="rounded-xl border border-[#e4d9d0] bg-[#fcf8f3] px-3 py-3 text-sm font-semibold text-[#2a241f] transition hover:border-[#f35d3f] hover:text-[#d94a30]">
                  {label}
                </Link>
              ))}
            </div>
          </Panel>
        ) : null}

        {data && hasData ? (
          <>
            <section aria-label="Key metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {KPI_META.map((meta) => {
                const kpi = dashboardKpi(data.kpis as Record<string, Kpi | undefined>, meta.key);
                if (!kpi) return null;
                const value = meta.money
                  ? <Peso minor={Math.round(kpi.value)} />
                  : <span className="font-data">{kpi.value.toLocaleString("en-PH")}</span>;
                return (
                  <MetricCard
                    key={meta.key}
                    label={meta.label}
                    value={value}
                    icon={meta.icon}
                    tone={meta.tone}
                    meta={<Delta deltaMinor={kpi.deltaMinor ?? null} deltaPct={kpi.deltaPct ?? null} compareLabel={data.compareLabel} />}
                  />
                );
              })}
            </section>

            <div className="grid gap-4 xl:grid-cols-[1.65fr_1fr]">
              <Panel className="p-5">
                <SectionHeader
                  title="Sales performance"
                  description="Real sales and order movement across the selected period."
                  action={
                    <div className="flex rounded-[10px] bg-[#fcf8f3] p-1">
                      {(["revenue", "orders"] as const).map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => setMetric(item)}
                          className={"rounded-lg px-3 py-1.5 text-[10px] font-semibold capitalize " + (activeMetric === item ? "bg-[#fff0ea] text-[#e44e34]" : "text-[#73685f]")}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  }
                />
                <div className="mt-4 text-[#f35d3f]">
                  <VerticalBarChart
                    label={"Sales trend by " + activeMetric}
                    bars={dashboardSeries(data.series, activeMetric).map((point) => ({ label: point.bucket.slice(5), value: point.value }))}
                    height={190}
                  />
                </div>
              </Panel>

              <Panel className="p-5">
                <SectionHeader title="Store health" description="Operational items that need a human decision." action={<StatusPill tone={attention.length === 0 ? "ok" : "warn"}>{attention.length === 0 ? "Healthy" : attention.length + " alerts"}</StatusPill>} />
                {attention.length === 0 ? (
                  <div className="mt-5 rounded-xl bg-[#eaf7f0] p-4 text-sm font-medium text-[#1f8a5b]">No dashboard attention items right now.</div>
                ) : (
                  <ul className="mt-4 space-y-2">
                    {attention.slice(0, 4).map((item) => (
                      <li key={item.kind} className="flex items-center gap-3 rounded-xl bg-[#fcf8f3] p-3">
                        <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#fff4df] font-bold text-[#b56d0c]">!</span>
                        <div className="min-w-0 flex-1">
                          <Link href={item.href} className="block truncate text-[12px] font-semibold text-[#2a241f] hover:text-[#d94a30]">{item.label}</Link>
                          <p className="mt-0.5 text-[10px] text-[#8b8077]">{item.count} item(s) · Review now</p>
                        </div>
                      </li>
                    ))}
                    {syncStore ? <SyncAttentionItems store={syncStore} /> : null}
                  </ul>
                )}
              </Panel>
            </div>

            <Panel className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="mr-1 grid h-9 w-9 place-items-center rounded-xl bg-[#fff0ea] font-display text-[#f35d3f]">ϟ</div>
                <div className="mr-auto">
                  <p className="font-display text-sm font-semibold">Quick actions</p>
                  <p className="text-[10px] text-[#7a6f66]">Common tasks to keep the store moving.</p>
                </div>
                {[
                  ["New sale", "/pos"],
                  ["Add product", "/products"],
                  ["Receive inventory", "/inventory"],
                  ["Manage customers", "/customers"],
                  ["View reports", "/reports/sales"],
                ].map(([label, href], index) => (
                  <Link
                    key={href}
                    href={href}
                    className={"rounded-[10px] px-4 py-2 text-[11px] font-semibold " + (index === 0 ? "bg-[#f35d3f] text-white shadow-[0_8px_20px_-8px_rgb(243_93_63/0.45)]" : "border border-[#e4d9d0] bg-white text-[#2a241f] hover:border-[#f35d3f]")}
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </Panel>

            <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
              <Panel className="p-5">
                <SectionHeader title="Top selling products" description="Best-performing products for this selected range." action={<Link href="/reports/products" className="text-[11px] font-semibold text-[#e44e34]">View all →</Link>} />
                <div className="mt-4 overflow-x-auto">
                  <table className="premium-table min-w-[560px] text-left text-[12px]">
                    <thead>
                      <tr><th className="pb-3">Product</th><th className="pb-3 text-right">Units</th><th className="pb-3 text-right">Revenue</th></tr>
                    </thead>
                    <tbody>
                      {data.topProducts.slice(0, 5).map((product) => (
                        <tr key={product.productId}>
                          <td className="py-3 font-semibold text-[#2a241f]">{product.name}</td>
                          <td className="font-data py-3 text-right text-[#73685f]">{product.qty.toLocaleString("en-PH")}</td>
                          <td className="font-data py-3 text-right font-medium text-[#2a241f]">₱{money(product.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel className="p-5">
                <SectionHeader title="Operating summary" description="Real exception totals for the selected range." />
                <dl className="mt-4 space-y-3">
                  <div className="flex items-center justify-between rounded-xl bg-[#fcf8f3] p-3">
                    <dt className="text-[11px] text-[#73685f]">Refunds</dt>
                    <dd className="font-data text-sm font-semibold">₱{money(data.kpis.refundTotal.value)}</dd>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-[#fcf8f3] p-3">
                    <dt className="text-[11px] text-[#73685f]">Discounts</dt>
                    <dd className="font-data text-sm font-semibold">₱{money(data.kpis.discountTotal.value)}</dd>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-[#fcf8f3] p-3">
                    <dt className="text-[11px] text-[#73685f]">Expenses</dt>
                    <dd className="font-data text-sm font-semibold">₱{money(data.kpis.expenseTotal.value)}</dd>
                  </div>
                </dl>
              </Panel>
            </div>

            <nav aria-label="Reports" className="flex flex-wrap gap-2 pb-2">
              {["sales", "products", "inventory", "payments", "cash", "customers", "cashiers", "branches"].map((report) => (
                <Link key={report} href={"/reports/" + report} className="rounded-full border border-[#e4d9d0] bg-white px-3 py-1.5 text-[10px] font-semibold capitalize text-[#73685f] hover:border-[#f35d3f] hover:text-[#d94a30]">
                  {report}
                </Link>
              ))}
            </nav>
          </>
        ) : null}
      </main>
    </AppShell>
  );
}
