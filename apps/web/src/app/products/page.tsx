"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
import { ApiError, apiFetch } from "../../lib/api";
import { buildProductSearch } from "../../lib/catalog";

interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  priceMinor: number;
  isActive: boolean;
}

interface SearchResult {
  items: ProductRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface Me {
  role: string;
  businessName?: string;
}

export default function ProductsPage(): JSX.Element {
  const [q, setQ] = useState("");
  const [active, setActive] = useState("true");
  const [page, setPage] = useState(1);
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<Me>("/api/v1/me"),
    retry: false,
  });
  const searchQuery = useQuery({
    queryKey: ["products", q, active, page],
    queryFn: () => apiFetch<SearchResult>(buildProductSearch({ q, active, page, pageSize: 20 })),
    retry: false,
  });

  if (searchQuery.isLoading) {
    return (
      <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
        <main className="mx-auto max-w-[1240px] p-6">
          <Panel className="p-6 text-sm text-[#73685f]">Loading products…</Panel>
        </main>
      </AppShell>
    );
  }

  if (searchQuery.isError) {
    return (
      <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
        <main className="mx-auto max-w-[1240px] p-6">
          <Panel className="border-[#efb9b9] bg-[#fff0f0] p-6">
            <p role="alert" className="text-sm font-medium text-[#9d3030]">
              {searchQuery.error instanceof ApiError
                ? searchQuery.error.code + ": " + searchQuery.error.message
                : "Could not load products."}
            </p>
          </Panel>
        </main>
      </AppShell>
    );
  }

  const data = searchQuery.data!;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const visibleActive = data.items.filter((product) => product.isActive).length;
  const visibleArchived = data.items.length - visibleActive;

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Catalog / Product management"
          title="Products"
          description="Build a clean catalog, keep sellable items easy to find, and move from product setup to checkout without losing context."
          actions={
            <>
              <GhostButton type="button">⇩ Import / Export</GhostButton>
              <Link href="/products/new" className="inline-flex min-h-10 items-center rounded-[10px] bg-[#f35d3f] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] hover:bg-[#d94a30]">
                + Add product
              </Link>
            </>
          }
        />

        <section aria-label="Catalog summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Matching products" value={data.total.toLocaleString("en-PH")} icon="◇" meta={active === "all" ? "All statuses" : active === "true" ? "Active filter" : "Archived filter"} />
          <MetricCard label="Visible active" value={visibleActive} icon="✓" tone="success" meta={"Current page · " + data.items.length + " shown"} />
          <MetricCard label="Visible archived" value={visibleArchived} icon="—" tone={visibleArchived > 0 ? "warning" : "success"} meta="Current page only" />
          <MetricCard label="Page" value={data.page + " / " + pages} icon="▦" tone="info" meta={data.pageSize + " products per page"} />
        </section>

        <Panel className="p-5">
          <SectionHeader title="Catalog controls" description="Search by product name, SKU, or barcode and narrow the catalog by status." />
          <form
            className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              void searchQuery.refetch();
            }}
          >
            <label className="text-[11px] font-semibold text-[#655b53]">
              Product search
              <input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Search product, SKU or barcode…"
                className="field mt-1.5"
              />
            </label>
            <label className="text-[11px] font-semibold text-[#655b53]">
              Status
              <select
                value={active}
                onChange={(event) => {
                  setActive(event.target.value);
                  setPage(1);
                }}
                className="field mt-1.5"
              >
                <option value="true">Active</option>
                <option value="false">Archived</option>
                <option value="all">All</option>
              </select>
            </label>
            <PrimaryButton type="submit" className="self-end">Search catalog</PrimaryButton>
          </form>
        </Panel>

        <DataTableFrame>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <h2 className="font-display text-base font-semibold">Products</h2>
              <p className="mt-1 text-[11px] text-[#7a6f66]">{data.total} result{data.total === 1 ? "" : "s"} · page {data.page} of {pages}</p>
            </div>
            <Link href="/categories" className="text-[11px] font-semibold text-[#e44e34]">Manage categories →</Link>
          </div>
          <table className="premium-table min-w-[720px] text-left text-[12px]">
            <thead>
              <tr>
                <th className="px-5 pb-3">Product</th>
                <th className="px-5 pb-3">SKU</th>
                <th className="px-5 pb-3 text-right">Price</th>
                <th className="px-5 pb-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((product) => (
                <tr key={product.id}>
                  <td className="px-5 py-3">
                    <Link href={"/products/" + product.id} className="font-semibold text-[#2a241f] hover:text-[#d94a30]">{product.name}</Link>
                  </td>
                  <td className="font-data px-5 py-3 text-[#73685f]">{product.sku ?? "—"}</td>
                  <td className="font-data px-5 py-3 text-right font-medium">₱{(product.priceMinor / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-5 py-3 text-right">
                    <StatusPill tone={product.isActive ? "ok" : "warn"}>{product.isActive ? "Active" : "Archived"}</StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.items.length === 0 ? <div className="border-t border-[#eee6de] px-5 py-10 text-center text-sm text-[#8b8077]">No products match this filter.</div> : null}
          <div className="flex items-center justify-end gap-2 border-t border-[#eee6de] px-5 py-4">
            <GhostButton type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</GhostButton>
            <GhostButton type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</GhostButton>
          </div>
        </DataTableFrame>
      </main>
    </AppShell>
  );
}
