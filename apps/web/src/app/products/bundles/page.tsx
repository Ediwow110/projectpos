"use client";

import { useEffect, useMemo, useState, type JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../../../components/AppShell";
import { PageHeader, Panel, SectionHeader } from "../../../components/premium";
import { GhostButton, PrimaryButton } from "../../../components/ui";
import { ApiError, apiFetch } from "../../../lib/api";

interface Product { id: string; name: string; sku: string | null; productType?: string; trackInventory: boolean }
interface ComponentRow { productId: string; quantity: number }
interface BundleRecord { id: string; version: number; product: Product & { priceMinor: number; costMinor: number }; components: Array<{ componentProductId: string; quantity: number }> }
interface Csrf { csrfToken: string }

export default function BundlesPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = useState(""); const [sku, setSku] = useState(""); const [price, setPrice] = useState(""); const [cost, setCost] = useState("");
  const [selectedBundleId, setSelectedBundleId] = useState(""); const [componentRows, setComponentRows] = useState<ComponentRow[]>([]); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const products = useQuery({ queryKey: ["bundle-components"], queryFn: () => apiFetch<{ items: Product[] }>("/api/v1/products?active=true&page=1&pageSize=100"), retry: false });
  const bundles = useQuery({ queryKey: ["bundles"], queryFn: () => apiFetch<{ items: BundleRecord[] }>("/api/v1/bundles"), retry: false });
  const selectedBundle = bundles.data?.items.find((bundle) => bundle.id === selectedBundleId) ?? null;
  const availability = useQuery({ queryKey: ["bundle-availability", selectedBundle?.product.id], queryFn: () => apiFetch<{ available: number }>(`/api/v1/products/${selectedBundle!.product.id}/bundle-availability`), enabled: selectedBundle !== null, retry: false });
  const components = useMemo(() => (products.data?.items ?? []).filter((product) => product.trackInventory && product.productType !== "BUNDLE"), [products.data?.items]);
  const duplicateComponent = new Set(componentRows.map((row) => row.productId)).size !== componentRows.length;
  const invalidQuantity = componentRows.some((row) => !row.productId || !Number.isInteger(row.quantity) || row.quantity < 1);
  const canSave = componentRows.length > 0 && !duplicateComponent && !invalidQuantity && !products.isLoading;

  useEffect(() => { if (selectedBundle) setComponentRows(selectedBundle.components.map((component) => ({ productId: component.componentProductId, quantity: component.quantity }))); }, [selectedBundle]);
  function resetEditor(): void { setSelectedBundleId(""); setComponentRows([]); setName(""); setSku(""); setPrice(""); setCost(""); }
  function updateRow(index: number, patch: Partial<ComponentRow>): void { setComponentRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row)); }
  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault(); setMessage(""); setError("");
    if (!canSave) { setError("Each component needs a unique product and an integer quantity of at least 1."); return; }
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      if (selectedBundleId) {
        await apiFetch(`/api/v1/bundles/${selectedBundleId}`, { csrfToken: csrf.csrfToken, init: { method: "PATCH", body: JSON.stringify({ components: componentRows }) } });
        setMessage("Bundle quantities updated. Existing sale snapshots remain unchanged.");
      } else {
        await apiFetch("/api/v1/bundles", { csrfToken: csrf.csrfToken, init: { method: "POST", body: JSON.stringify({ name, sku, priceMinor: Math.round(Number(price) * 100), costMinor: Math.round(Number(cost || "0") * 100), components: componentRows }) } });
        setMessage("Bundle created. Its availability is derived from component stock.");
      }
      await queryClient.invalidateQueries({ queryKey: ["bundles"] }); resetEditor();
    } catch (caught) { setError(caught instanceof ApiError ? `${caught.code}: ${caught.message}` : "Bundle save failed."); }
  }
  const selectedName = selectedBundle ? `${selectedBundle.product.name}${selectedBundle.product.sku ? ` · ${selectedBundle.product.sku}` : ""}` : "Create a new bundle";
  return <AppShell><main className="mx-auto max-w-[1100px] space-y-5 px-4 pb-10 pt-3 sm:px-6"><PageHeader eyebrow="Catalog / Bundles" title="Bundles & kits" description="Sell a fixed kit while consuming only its tracked component products." actions={<GhostButton type="button" onClick={() => window.location.assign("/products/families")}>Variants →</GhostButton>} /><Panel className="p-5"><SectionHeader title="Bundle editor" description="Choose an existing bundle to edit its component quantities, or create a new one. Bundle stock is always derived." /><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-[11px] font-semibold text-[#655b53]">Existing bundle<select value={selectedBundleId} onChange={(event) => { setSelectedBundleId(event.target.value); setMessage(""); setError(""); }} className="field mt-1.5"><option value="">{selectedName}</option>{(bundles.data?.items ?? []).map((bundle) => <option key={bundle.id} value={bundle.id}>{bundle.product.name}{bundle.product.sku ? ` · ${bundle.product.sku}` : ""}</option>)}</select></label>{selectedBundle ? <div className="rounded-xl bg-[#f7f1ea] px-3 py-2 text-xs text-[#655b53]"><span className="font-semibold">Derived availability</span><br />{availability.isLoading ? "Checking…" : availability.data?.available ?? 0} bundle(s) available</div> : null}</div><form onSubmit={(event) => void save(event)} className="mt-4 space-y-5">{!selectedBundle ? <div className="grid gap-3 sm:grid-cols-2"><label className="text-[11px] font-semibold text-[#655b53]">Bundle name<input value={name} onChange={(event) => setName(event.target.value)} className="field mt-1.5" required /></label><label className="text-[11px] font-semibold text-[#655b53]">SKU<input value={sku} onChange={(event) => setSku(event.target.value)} className="field mt-1.5" required /></label><label className="text-[11px] font-semibold text-[#655b53]">Selling price<input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" className="field mt-1.5" required /></label><label className="text-[11px] font-semibold text-[#655b53]">Cost snapshot<input value={cost} onChange={(event) => setCost(event.target.value)} inputMode="decimal" className="field mt-1.5" /></label></div> : null}<fieldset className="rounded-xl border border-[#eee4db] bg-[#fcf8f3] p-3"><legend className="px-1 text-[11px] font-semibold text-[#655b53]">Components</legend><div className="space-y-2">{componentRows.map((row, index) => <div key={`${index}-${row.productId}`} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_auto]"><label className="text-[11px] font-semibold text-[#655b53]">Product<select aria-label={`Component ${index + 1} product`} value={row.productId} onChange={(event) => updateRow(index, { productId: event.target.value })} className="field mt-1.5"><option value="">Select product</option>{components.map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ""}</option>)}</select></label><label className="text-[11px] font-semibold text-[#655b53]">Quantity per bundle<input aria-label={`Component ${index + 1} quantity`} type="number" min={1} step={1} value={row.quantity} onChange={(event) => updateRow(index, { quantity: Number(event.target.value) })} className="field mt-1.5" /></label><GhostButton type="button" className="self-end" onClick={() => setComponentRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>Remove</GhostButton></div>)}</div><GhostButton type="button" className="mt-3" onClick={() => setComponentRows((rows) => [...rows, { productId: "", quantity: 1 }])}>+ Add component</GhostButton>{duplicateComponent ? <p role="alert" className="mt-2 text-xs text-[#b33d32]">Each product may appear only once in a bundle.</p> : null}{invalidQuantity ? <p role="alert" className="mt-2 text-xs text-[#b33d32]">Quantities must be whole numbers of at least 1.</p> : null}</fieldset><div className="flex flex-wrap gap-2"><PrimaryButton type="submit" disabled={!canSave}>{selectedBundle ? "Save component quantities" : "Create bundle"}</PrimaryButton>{selectedBundle ? <GhostButton type="button" onClick={resetEditor}>Create new bundle</GhostButton> : null}</div>{message ? <p role="status" className="text-sm text-[#1f8a5b]">{message}</p> : null}{error ? <p role="alert" className="text-sm text-[#b33d32]">{error}</p> : null}</form></Panel></main></AppShell>;
}
