"use client";

import type { JSX } from "react";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../../components/AppShell";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { Modal } from "../../../components/Modal";
import { MetricCard, PageHeader, Panel, SectionHeader } from "../../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../../components/ui";
import { ApiError, apiFetch } from "../../../lib/api";
import { canEditCatalog, canSeeCost } from "../../../lib/catalog";
import { formatMoneyMinor, minorToMajorFixed } from "../../../lib/money";
import { validProductImageUrl } from "../../../lib/product-image";

interface ProductDetail {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  brand: string | null;
  unit: string;
  costMinor?: number;
  priceMinor: number;
  taxRateBps: number | null;
  reorderLevel: number;
  trackInventory: boolean;
  isActive: boolean;
  categoryId: string | null;
  imageUrl: string | null;
}

interface Category {
  id: string;
  name: string;
  isActive: boolean;
}

interface Me {
  role: string;
  businessName?: string;
}

interface Csrf {
  csrfToken: string;
}

function money(minor: number): string {
  return formatMoneyMinor(minor);
}

function toMinor(value: string): number | null {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const minor = Math.round(amount * 100);
  return Number.isSafeInteger(minor) ? minor : null;
}

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }): JSX.Element {
  const { id } = use(params);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [brand, setBrand] = useState("");
  const [unit, setUnit] = useState("pc");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [reorderLevel, setReorderLevel] = useState("0");
  const [trackInventory, setTrackInventory] = useState(true);
  const [categoryId, setCategoryId] = useState("");

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const detailQuery = useQuery({ queryKey: ["product", id], queryFn: () => apiFetch<ProductDetail>(`/api/v1/products/${id}`), retry: false });
  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: () => apiFetch<{ items: Category[] }>("/api/v1/categories"), retry: false });

  const product = detailQuery.data;
  const role = meQuery.data?.role ?? "cashier";
  const editable = canEditCatalog(role);
  const showCost = canSeeCost(role);
  const categoryName = product?.categoryId ? categoriesQuery.data?.items.find((category) => category.id === product.categoryId)?.name ?? "Unknown category" : "Uncategorized";

  useEffect(() => {
    if (!editOpen || !product) return;
    setName(product.name);
    setSku(product.sku ?? "");
    setBarcode(product.barcode ?? "");
    setImageUrl(product.imageUrl ?? "");
    setBrand(product.brand ?? "");
    setUnit(product.unit);
    setPrice(minorToMajorFixed(product.priceMinor));
    setCost(minorToMajorFixed(product.costMinor ?? 0));
    setReorderLevel(String(product.reorderLevel));
    setTrackInventory(product.trackInventory);
    setCategoryId(product.categoryId ?? "");
    setError("");
  }, [editOpen, product]);

  async function mutate(path: string, init: RequestInit): Promise<void> {
    const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
    await apiFetch(path, { csrfToken: csrf.csrfToken, init });
    await detailQuery.refetch();
  }

  async function saveProduct(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!name.trim()) {
      setError("VALIDATION: Product name is required.");
      return;
    }
    const priceMinor = toMinor(price);
    const costMinor = showCost ? toMinor(cost) : undefined;
    const reorder = Number(reorderLevel);
    if (priceMinor === null || (showCost && costMinor === null) || !Number.isInteger(reorder) || reorder < 0) {
      setError("VALIDATION: Check price, cost, and reorder level values.");
      return;
    }
    if (!validProductImageUrl(imageUrl)) {
      setError("VALIDATION: Image must be a valid HTTP(S) URL of 500 characters or fewer.");
      return;
    }
    setBusy(true);
    try {
      await mutate(`/api/v1/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          sku: sku.trim() || null,
          barcode: barcode.trim() || null,
          imageUrl: imageUrl.trim() || null,
          brand: brand.trim() || null,
          unit: unit.trim() || "pc",
          priceMinor,
          ...(showCost && costMinor !== undefined ? { costMinor } : {}),
          reorderLevel: reorder,
          trackInventory,
          categoryId: categoryId || null,
        }),
      });
      setEditOpen(false);
      setSuccess("Product updated.");
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(): Promise<void> {
    if (!product) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await mutate(`/api/v1/products/${id}/${product.isActive ? "archive" : "restore"}`, { method: "POST" });
      setConfirmOpen(false);
      setSuccess(product.isActive ? "Product archived." : "Product restored.");
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  if (detailQuery.isError || (!detailQuery.isLoading && !product)) {
    return <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}><main className="mx-auto max-w-[1240px] p-6"><Panel className="border-[#efb9b9] bg-[#fff0f0] p-6"><p role="alert" className="text-sm font-medium text-[#c43e3e]">Product not found.</p><Link href="/products" className="mt-3 inline-block text-sm font-semibold text-[#e44e34]">← Back to products</Link></Panel></main></AppShell>;
  }

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Catalog / Product detail"
          title={product?.name ?? "Product"}
          description="Review catalog identity, pricing, and inventory behavior. Historical sales retain their recorded line values."
          actions={
            <>
              <Link href="/products" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">← Products</Link>
              {product ? <Link href={`/inventory/${product.id}`} className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">Inventory ledger</Link> : null}
              {editable ? <PrimaryButton type="button" onClick={() => setEditOpen(true)}>Edit product</PrimaryButton> : null}
            </>
          }
        />

        {product ? (
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Product summary">
            <MetricCard label="Selling price" value={`₱${money(product.priceMinor)}`} icon="₱" meta="Current catalog price" />
            {showCost ? <MetricCard label="Cost" value={`₱${money(product.costMinor ?? 0)}`} icon="−" tone="info" meta="Visible to your role" /> : <MetricCard label="Cost access" value="Hidden" icon="◇" tone="warning" meta="Permission protected" />}
            <MetricCard label="Reorder level" value={product.reorderLevel} icon="▦" tone="info" meta={product.trackInventory ? "Inventory tracked" : "Inventory untracked"} />
            <MetricCard label="Catalog status" value={<span className="text-base">{product.isActive ? "Active" : "Archived"}</span>} icon={product.isActive ? "✓" : "—"} tone={product.isActive ? "success" : "warning"} meta={categoryName} />
          </section>
        ) : null}

        {success ? <div role="status" className="rounded-xl border border-[#cfe9dc] bg-[#eaf7f0] px-4 py-3 text-sm font-medium text-[#1f8a5b]">{success}</div> : null}
        {error ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-4"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{error}</p></Panel> : null}

        {product ? (
          <div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
            <Panel className="p-5">
              <SectionHeader title="Product identity" description="Identifiers help scanning and catalog search. Empty optional identifiers stay unset." />
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                {[
                  ["SKU", product.sku ?? "—"],
                  ["Barcode", product.barcode ?? "—"],
                  ["Brand", product.brand ?? "—"],
                  ["Unit", product.unit],
                  ["Category", categoryName],
                  ["Inventory", product.trackInventory ? "Tracked" : "Not tracked"],
                ].map(([label, value]) => <div key={label} className="rounded-xl bg-[#f7f1ea] p-3"><dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a8d83]">{label}</dt><dd className="mt-1 text-sm font-semibold text-[#2a241f]">{value}</dd></div>)}
              </dl>
            </Panel>
            <Panel className="p-5">
              <SectionHeader title="Lifecycle" description="Archive products instead of deleting them so historical receipts and reporting remain intact." />
              <div className="mt-4 flex items-center justify-between rounded-xl bg-[#f7f1ea] p-4"><div><p className="text-sm font-semibold text-[#2a241f]">Current status</p><div className="mt-2"><StatusPill tone={product.isActive ? "ok" : "warn"}>{product.isActive ? "Active" : "Archived"}</StatusPill></div></div>{editable ? <GhostButton type="button" onClick={() => setConfirmOpen(true)}>{product.isActive ? "Archive" : "Restore"}</GhostButton> : null}</div>
              {!editable ? <p className="mt-4 text-[11px] text-[#8b8077]">Your role can view this product but cannot change catalog pricing or lifecycle state.</p> : null}
            </Panel>
          </div>
        ) : <Panel className="p-6 text-sm text-[#73685f]">Loading product…</Panel>}
      </main>

      <Modal
        open={editOpen && editable && product !== undefined}
        onClose={() => !busy && setEditOpen(false)}
        title="Edit product"
        description="Update the current catalog record. This does not rewrite historical sale lines or inventory ledger entries."
        footer={<div className="flex justify-end gap-2"><GhostButton type="button" onClick={() => setEditOpen(false)} disabled={busy}>Cancel</GhostButton><PrimaryButton type="submit" form="product-edit-form" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save changes"}</PrimaryButton></div>}
      >
        <form id="product-edit-form" noValidate onSubmit={(event) => void saveProduct(event)} className="space-y-5">
          <section><SectionHeader title="Identity" /><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-[11px] font-semibold text-[#655b53] sm:col-span-2">Name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} className="field mt-1.5" /></label><label className="text-[11px] font-semibold text-[#655b53]">SKU<input value={sku} onChange={(event) => setSku(event.target.value)} maxLength={64} className="field mt-1.5" /></label><label className="text-[11px] font-semibold text-[#655b53]">Barcode<input value={barcode} onChange={(event) => setBarcode(event.target.value)} maxLength={64} className="field mt-1.5" /></label><label className="text-[11px] font-semibold text-[#655b53]">Brand<input value={brand} onChange={(event) => setBrand(event.target.value)} maxLength={80} className="field mt-1.5" /></label><label className="text-[11px] font-semibold text-[#655b53]">Category<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="field mt-1.5"><option value="">Uncategorized</option>{(categoriesQuery.data?.items ?? []).filter((category) => category.isActive || category.id === product?.categoryId).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="text-[11px] font-semibold text-[#655b53] sm:col-span-2">Product image URL (optional)<input type="url" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} maxLength={500} placeholder="https://images.example.com/product.jpg" className="field mt-1.5" /><span className="mt-1 block font-normal text-[#8b8077]">Use a publicly accessible HTTP(S) image link. Clear it to remove the image from POS.</span></label></div></section>
          <section className="border-t border-[#eadfd6] pt-5"><SectionHeader title="Pricing and inventory" /><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-[11px] font-semibold text-[#655b53]">Selling price (PHP)<input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" className="field mt-1.5" /></label>{showCost ? <label className="text-[11px] font-semibold text-[#655b53]">Cost (PHP)<input value={cost} onChange={(event) => setCost(event.target.value)} inputMode="decimal" className="field mt-1.5" /></label> : null}<label className="text-[11px] font-semibold text-[#655b53]">Unit<input value={unit} onChange={(event) => setUnit(event.target.value)} maxLength={16} className="field mt-1.5" /></label><label className="text-[11px] font-semibold text-[#655b53]">Reorder level<input type="number" min={0} step={1} value={reorderLevel} onChange={(event) => setReorderLevel(event.target.value)} className="field mt-1.5" /></label><label className="flex min-h-[50px] items-center gap-3 rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-[12px] font-semibold text-[#655b53] sm:col-span-2"><input type="checkbox" checked={trackInventory} onChange={(event) => setTrackInventory(event.target.checked)} className="h-4 w-4 accent-[#f35d3f]" />Track inventory for this product</label></div></section>
          {error ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{error}</p> : null}
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmOpen && product !== undefined}
        onCancel={() => !busy && setConfirmOpen(false)}
        onConfirm={() => void toggleActive()}
        busy={busy}
        tone={product?.isActive ? "danger" : "primary"}
        title={product?.isActive ? "Archive product?" : "Restore product?"}
        description={product?.isActive ? "The item will disappear from active selling/catalog searches, but historical sales and inventory records remain intact." : "The product will return to the active catalog and become sellable again where permissions and stock rules allow."}
        confirmLabel={product?.isActive ? "Archive product" : "Restore product"}
        details={product ? <strong className="text-[#2a241f]">{product.name}</strong> : null}
      />
    </AppShell>
  );
}
