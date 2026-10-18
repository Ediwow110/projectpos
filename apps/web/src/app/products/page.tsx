"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { Modal } from "../../components/Modal";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
import { ApiError, apiFetch } from "../../lib/api";
import { buildProductSearch, canEditCatalog, canSeeCost } from "../../lib/catalog";
import { parseProductCsv, productRowsToCsv } from "../../lib/catalog-io";
import { formatMoneyMinor } from "../../lib/money";
import { validProductImageUrl } from "../../lib/product-image";
import { createCatalogProductRequest, importCatalogProductsRequest } from "../../lib/products-api";
import { useProductsPageState } from "./use-products-page-state";

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

interface Category {
  id: string;
  name: string;
  isActive: boolean;
}

function toMinor(value: string): number | null {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const minor = Math.round(amount * 100);
  return Number.isSafeInteger(minor) ? minor : null;
}

export default function ProductsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [newProductId, setNewProductId] = useState<string | null>(null);
  const {
    q, setQ, active, setActive, page, setPage,
    createOpen, setCreateOpen, createError, setCreateError,
    createSuccess, setCreateSuccess, saving, setSaving,
    name, setName, sku, setSku, barcode, setBarcode, imageUrl, setImageUrl, categoryId, setCategoryId,
    price, setPrice, cost, setCost, unit, setUnit,
    reorderLevel, setReorderLevel, trackInventory, setTrackInventory,
    importOpen, setImportOpen, importText, setImportText,
    importError, setImportError, importing, setImporting,
  } = useProductsPageState();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<Me>("/api/v1/me"),
    retry: false,
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<{ items: Category[] }>("/api/v1/categories"),
    retry: false,
    enabled: createOpen,
  });

  const closeCreate = useCallback((): void => {
    if (saving) return;
    setCreateOpen(false);
    setCreateError("");
    if (typeof window !== "undefined" && window.location.search.includes("create=1")) {
      window.history.replaceState(null, "", "/products");
    }
  }, [saving, setCreateError, setCreateOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const shouldCreate = new URLSearchParams(window.location.search).get("create") === "1";
    if (shouldCreate) setCreateOpen(true);
  }, [setCreateOpen]);

  async function createProduct(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setCreateError("");
    setNewProductId(null);
    if (!name.trim()) {
      setCreateError("VALIDATION: Product name is required.");
      return;
    }
    if (!unit.trim()) {
      setCreateError("VALIDATION: Unit is required.");
      return;
    }
    const priceMinor = toMinor(price);
    const costMinor = cost.trim() === "" ? 0 : toMinor(cost);
    const reorder = Number(reorderLevel);
    if (priceMinor === null) {
      setCreateError("VALIDATION: Enter a valid non-negative selling price.");
      return;
    }
    if (costMinor === null) {
      setCreateError("VALIDATION: Enter a valid non-negative cost.");
      return;
    }
    if (!Number.isInteger(reorder) || reorder < 0) {
      setCreateError("VALIDATION: Reorder level must be a whole number of 0 or more.");
      return;
    }
    if (!validProductImageUrl(imageUrl)) {
      setCreateError("VALIDATION: Image must be a valid HTTP(S) URL of 500 characters or fewer.");
      return;
    }

    setSaving(true);
    try {
      const created = await createCatalogProductRequest({
        name: name.trim(),
        ...(sku.trim() ? { sku: sku.trim() } : {}),
        ...(barcode.trim() ? { barcode: barcode.trim() } : {}),
        ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
        ...(categoryId ? { categoryId } : {}),
        unit: unit.trim() || "pc",
        priceMinor,
        costMinor,
        reorderLevel: reorder,
        trackInventory,
      });
      setName("");
      setSku("");
      setBarcode("");
      setImageUrl("");
      setCategoryId("");
      setPrice("");
      setCost("");
      setUnit("pc");
      setReorderLevel("0");
      setTrackInventory(true);
      setCreateSuccess(`${created.name} was added to the catalog.`);
      setNewProductId(created.id);
      setCreateOpen(false);
      if (typeof window !== "undefined" && window.location.search.includes("create=1")) {
        window.history.replaceState(null, "", "/products");
      }
      await queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (err) {
      setCreateError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Product create failed");
    } finally {
      setSaving(false);
    }
  }

  async function importProducts(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setImportError("");
    setCreateSuccess("");
    let items;
    try {
      items = parseProductCsv(importText);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Invalid CSV");
      return;
    }
    setImporting(true);
    try {
      await importCatalogProductsRequest(items);
      setImportOpen(false);
      setImportText("");
      setCreateSuccess(`${items.length} product${items.length === 1 ? "" : "s"} imported.`);
      await queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (err) {
      setImportError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  function exportCurrentPage(rows: ProductRow[]): void {
    const csv = productRowsToCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `nexpos-products-page-${page}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
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
  const role = meQuery.data?.role ?? "cashier";
  const editable = canEditCatalog(role);
  const showCost = canSeeCost(role);

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Catalog / Product management"
          title="Products"
          description="Build a clean catalog, keep sellable items easy to find, and move from product setup to checkout without losing context."
          actions={
            <>
              <GhostButton type="button" onClick={() => exportCurrentPage(data.items)} disabled={data.items.length === 0}>⇩ Export current page</GhostButton>
              {editable ? <GhostButton type="button" onClick={() => { setImportError(""); setImportOpen(true); }}>⇧ Import CSV</GhostButton> : null}
              {editable ? (
                <button
                  type="button"
                  onClick={() => {
                    setCreateError("");
                    setCreateSuccess("");
                    setNewProductId(null);
                    setCreateOpen(true);
                  }}
                  className="inline-flex min-h-10 items-center rounded-[10px] bg-[#f35d3f] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] hover:bg-[#d94a30]"
                >
                  + Add product
                </button>
              ) : null}
            </>
          }
        />

        {createSuccess ? (
          <div role="status" className="rounded-xl border border-[#cfe9dc] bg-[#eaf7f0] px-4 py-3 text-sm font-medium text-[#1f8a5b]">
            {createSuccess} {newProductId && role === "owner" ? <Link href={`/products/${newProductId}`} className="ml-2 underline">Open product to upload a photo →</Link> : null}
          </div>
        ) : null}

        <section aria-label="Catalog summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Matching products" value={data.total.toLocaleString("en-PH")} icon="◇" meta={active === "all" ? "All statuses" : active === "true" ? "Active filter" : "Archived filter"} />
          <MetricCard label="Visible active" value={visibleActive} icon="✓" tone="success" meta={"Current page · " + data.items.length + " shown"} />
          <MetricCard label="Visible archived" value={visibleArchived} icon="—" tone={visibleArchived > 0 ? "warning" : "success"} meta="Current page only" />
          <MetricCard label="Page" value={data.page + " / " + pages} icon="▦" tone="info" meta={data.pageSize + " products per page"} />
        </section>

        <Panel className="p-5">
          <SectionHeader title="Catalog controls" description="Search by product name, SKU, or barcode and narrow the catalog by status." />
          <form
            noValidate
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
            <div className="flex items-center gap-4"><Link href="/products/families" className="text-[11px] font-semibold text-[#e44e34]">Manage variants →</Link><Link href="/products/bundles" className="text-[11px] font-semibold text-[#e44e34]">Manage bundles →</Link><Link href="/products/labels" className="text-[11px] font-semibold text-[#e44e34]">Barcode labels →</Link><Link href="/categories" className="text-[11px] font-semibold text-[#e44e34]">Manage categories →</Link></div>
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
                  <td className="font-data px-5 py-3 text-right font-medium">₱{formatMoneyMinor(product.priceMinor)}</td>
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

      <Modal
        open={createOpen && editable}
        onClose={closeCreate}
        title="Add product"
        description="Create a sellable catalog item without leaving the Products workspace. Inventory quantity is recorded separately as an audited stock movement."
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <GhostButton type="button" onClick={closeCreate} disabled={saving}>Cancel</GhostButton>
            <PrimaryButton type="submit" form="create-product-form" disabled={saving}>
              {saving ? "Adding product…" : "Add product"}
            </PrimaryButton>
          </div>
        }
      >
        <form id="create-product-form" noValidate onSubmit={(event) => void createProduct(event)} className="space-y-5">
          <section>
            <SectionHeader title="Product identity" description="Name is required. SKU and barcode are optional but must remain unique within the business." />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-[11px] font-semibold text-[#655b53] sm:col-span-2">
                Product name
                <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} autoFocus placeholder="e.g. Iced Latte" className="field mt-1.5" />
              </label>
              <label className="text-[11px] font-semibold text-[#655b53]">
                SKU
                <input value={sku} onChange={(event) => setSku(event.target.value)} maxLength={64} placeholder="Optional" className="field mt-1.5" />
              </label>
              <label className="text-[11px] font-semibold text-[#655b53]">
                Barcode
                <input value={barcode} onChange={(event) => setBarcode(event.target.value)} maxLength={64} placeholder="Optional" className="field mt-1.5" />
              </label>
              <label className="text-[11px] font-semibold text-[#655b53] sm:col-span-2">
                Product image URL (optional)
                <input type="url" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} maxLength={500} placeholder="https://images.example.com/product.jpg" className="field mt-1.5" />
                <span className="mt-1 block font-normal text-[#8b8077]">Use a publicly accessible HTTP(S) image link. It appears on POS product tiles.</span>
              </label>
              <label className="text-[11px] font-semibold text-[#655b53]">
                Category
                <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="field mt-1.5">
                  <option value="">Uncategorized</option>
                  {(categoriesQuery.data?.items ?? []).filter((category) => category.isActive).map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] font-semibold text-[#655b53]">
                Unit
                <input value={unit} onChange={(event) => setUnit(event.target.value)} required maxLength={16} placeholder="pc" className="field mt-1.5" />
              </label>
            </div>
          </section>

          <section className="border-t border-[#eadfd6] pt-5">
            <SectionHeader title="Pricing" description="Amounts are stored in minor currency units and validated by the API." />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-[11px] font-semibold text-[#655b53]">
                Selling price (PHP)
                <input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} required placeholder="0.00" className="field mt-1.5" />
              </label>
              {showCost ? (
                <label className="text-[11px] font-semibold text-[#655b53]">
                  Cost (PHP)
                  <input inputMode="decimal" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="0.00" className="field mt-1.5" />
                </label>
              ) : null}
            </div>
          </section>

          <section className="border-t border-[#eadfd6] pt-5">
            <SectionHeader title="Inventory behavior" description="Creating a product does not fabricate opening stock. Add actual quantity later through Inventory movements." />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-[11px] font-semibold text-[#655b53]">
                Reorder level
                <input type="number" min={0} step={1} value={reorderLevel} onChange={(event) => setReorderLevel(event.target.value)} className="field mt-1.5" />
              </label>
              <label className="flex min-h-[54px] items-center gap-3 self-end rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-[12px] font-semibold text-[#655b53]">
                <input type="checkbox" checked={trackInventory} onChange={(event) => setTrackInventory(event.target.checked)} className="h-4 w-4 accent-[#f35d3f]" />
                Track inventory for this product
              </label>
            </div>
          </section>

          {categoriesQuery.isError ? <p className="text-[11px] text-[#b56d0c]">Categories could not be loaded. You can still create the product uncategorized.</p> : null}
          {createError ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{createError}</p> : null}
        </form>
      </Modal>

      <Modal
        open={importOpen && editable}
        onClose={() => !importing && setImportOpen(false)}
        title="Import products from CSV"
        description="Import up to 200 products in one batch. Required columns are name and price. Optional columns: sku, barcode, unit, cost, reorder_level, track_inventory."
        footer={<div className="flex justify-end gap-2"><GhostButton type="button" onClick={() => setImportOpen(false)} disabled={importing}>Cancel</GhostButton><PrimaryButton type="submit" form="product-import-form" disabled={importing || !importText.trim()}>{importing ? "Importing…" : "Import products"}</PrimaryButton></div>}
      >
        <form id="product-import-form" noValidate onSubmit={(event) => void importProducts(event)} className="space-y-4">
          <div className="rounded-xl bg-[#f7f1ea] p-3 text-[11px] leading-5 text-[#73685f]">
            <p className="font-semibold text-[#2a241f]">Example</p>
            <code className="font-data mt-2 block whitespace-pre-wrap text-[10px]">name,sku,price,cost,reorder_level,track_inventory{"\n"}Iced Latte,LAT-1,149.50,70.25,5,true</code>
          </div>
          <label className="block text-[11px] font-semibold text-[#655b53]">
            CSV content
            <textarea autoFocus value={importText} onChange={(event) => setImportText(event.target.value)} rows={11} className="field font-data mt-1.5 resize-none text-[11px]" placeholder="Paste CSV here…" />
          </label>
          <p className="text-[10px] leading-4 text-[#8b8077]">Import creates catalog records only. It does not fabricate opening stock; record actual quantities through Inventory movements afterward.</p>
          {importError ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{importError}</p> : null}
        </form>
      </Modal>
    </AppShell>
  );
}
