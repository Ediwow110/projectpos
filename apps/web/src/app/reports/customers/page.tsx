"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ReportPageFrame } from "../../../components/ReportPageFrame";
import { DataTableFrame, MetricCard, Panel, SectionHeader } from "../../../components/premium";
import { ApiError, apiFetch } from "../../../lib/api";
import { money } from "../../../lib/reports";

interface CustomersPayload { total: number; active: number; top: Array<{ customerId: string; name: string; spend: number; orders: number }>; }

export default function CustomersReportPage(): JSX.Element {
  const query = useQuery({ queryKey: ["report-customers"], queryFn: () => apiFetch<CustomersPayload>("/api/v1/reports/customers?compare=none"), retry: false });
  const data = query.data;
  const spend = data?.top.reduce((sum, customer) => sum + customer.spend, 0) ?? 0;
  return <ReportPageFrame title="Customers report" description="Review customer activity context from recorded purchases. This report does not turn customers into a product-facing leaderboard." actions={<Link href="/customers" className="inline-flex min-h-10 items-center rounded-[10px] bg-[#f35d3f] px-4 text-sm font-semibold text-white hover:bg-[#d94a30]">Customer directory</Link>}>{data ? <><section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Customers" value={data.total} icon="○" meta="Total profiles" /><MetricCard label="Active" value={data.active} icon="✓" tone="success" meta="Active profiles" /><MetricCard label="Visible activity rows" value={data.top.length} icon="▦" tone="info" meta="Returned by report" /><MetricCard label="Spend in rows" value={money(spend)} icon="₱" meta="Across visible activity rows" /></section><DataTableFrame><div className="px-5 py-4"><SectionHeader title="Customer purchase activity" description="Sorted by the backend report; shown here as operational context." /></div>{data.top.length === 0 ? <p className="px-5 pb-8 text-sm text-[#8b8077]">No customer purchases in range.</p> : <table className="premium-table min-w-[620px] text-left text-[12px]"><thead><tr><th className="px-5 pb-3">Customer</th><th className="px-5 pb-3 text-right">Spend</th><th className="px-5 pb-3 text-right">Orders</th><th className="px-5 pb-3 text-right">Profile</th></tr></thead><tbody>{data.top.map((customer) => <tr key={customer.customerId}><td className="px-5 py-3 font-semibold text-[#2a241f]">{customer.name}</td><td className="font-data px-5 py-3 text-right">{money(customer.spend)}</td><td className="font-data px-5 py-3 text-right">{customer.orders}</td><td className="px-5 py-3 text-right"><Link href={`/customers/${customer.customerId}`} className="text-[11px] font-semibold text-[#e44e34]">Open →</Link></td></tr>)}</tbody></table>}</DataTableFrame></> : null}{query.isLoading ? <Panel className="p-6 text-sm text-[#73685f]">Loading customer report…</Panel> : null}{query.isError ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-5"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{query.error instanceof ApiError ? `${query.error.code}: ${query.error.message}` : "Could not load report."}</p></Panel> : null}</ReportPageFrame>;
}
