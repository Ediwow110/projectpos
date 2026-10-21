"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../../components/AppShell";
import { DataTableFrame, PageHeader, Panel, SectionHeader } from "../../components/premium";
import { StatusPill } from "../../components/ui";
import { apiFetch } from "../../lib/api";
import type { SupplierReturn } from "../../lib/purchase-orders";

interface Me { role: string; businessName?: string }

export default function SupplierReturnsPage(): JSX.Element {
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const query = useQuery({ queryKey: ["supplier-returns"], queryFn: () => apiFetch<{ items: SupplierReturn[] }>("/api/v1/supplier-returns"), retry: false });
  const role = me.data?.role ?? "cashier";
  const tone = (status: string): "ok" | "warn" | "bad" => status === "POSTED" ? "ok" : status === "CANCELLED" ? "bad" : "warn";
  return <AppShell businessName={me.data?.businessName} role={role}><main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6"><PageHeader eyebrow="Procurement / Supplier returns" title="Supplier returns" description="Draft, review, and post inventory returns to suppliers." /><Panel className="p-5"><SectionHeader title="Return history" description="Posted returns reduce stock exactly once; drafts do not change stock." />{query.isLoading ? <p className="mt-5 text-sm text-[#73685f]">Loading returns…</p> : query.isError ? <p role="alert" className="mt-5 text-sm text-[#c43e3e]">Could not load supplier returns.</p> : query.data?.items.length ? <DataTableFrame className="mt-4"><table className="premium-table min-w-[720px] text-left text-[12px]"><thead><tr><th className="px-5 pb-3">Return</th><th className="px-5 pb-3">PO</th><th className="px-5 pb-3">Reason</th><th className="px-5 pb-3 text-right">Lines</th><th className="px-5 pb-3 text-right">Status</th></tr></thead><tbody>{query.data.items.map((item) => <tr key={item.id}><td className="px-5 py-3 font-semibold">{item.returnNumber}</td><td className="px-5 py-3"><Link className="text-[var(--color-atlas-accent-strong)]" href={`/purchase-orders/${item.purchaseOrderId}`}>Open purchase order</Link></td><td className="px-5 py-3 text-[#73685f]">{item.reason}</td><td className="font-data px-5 py-3 text-right">{item.lines.length}</td><td className="px-5 py-3 text-right"><StatusPill tone={tone(item.status)}>{item.status}</StatusPill></td></tr>)}</tbody></table></DataTableFrame> : <p className="mt-5 text-sm text-[var(--color-atlas-muted-strong)]">No supplier returns yet.</p>}</Panel></main></AppShell>;
}
