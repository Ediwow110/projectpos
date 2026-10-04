"use client";

import { useState, type JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../../../components/AppShell";
import { PageHeader, Panel, SectionHeader } from "../../../components/premium";
import { GhostButton, PrimaryButton } from "../../../components/ui";
import { ApiError, apiFetch } from "../../../lib/api";

interface Family { id: string; name: string; brand: string | null; options?: Array<{ id: string; name: string; values: Array<{ id: string; value: string }> }>; variants?: Array<{ product: { id: string; name: string; sku: string | null } }> }
interface Csrf { csrfToken: string }

export default function ProductFamiliesPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [optionsText, setOptionsText] = useState("Size:S|M");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [selectedValues, setSelectedValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const familiesQuery = useQuery({ queryKey: ["product-families"], queryFn: () => apiFetch<{ items: Family[] }>("/api/v1/product-families"), retry: false });
  const detailQuery = useQuery({ queryKey: ["product-family", selectedId], enabled: selectedId !== null, queryFn: () => apiFetch<Family>(`/api/v1/product-families/${selectedId}`), retry: false });

  async function csrf(): Promise<string> { return (await apiFetch<Csrf>("/api/v1/auth/csrf")).csrfToken; }
  async function createFamily(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const options = optionsText.split(";").map((entry) => { const [optionName, values] = entry.split(":"); return { name: optionName?.trim() ?? "", values: (values ?? "").split("|").map((value) => value.trim()).filter(Boolean) }; }).filter((option) => option.name && option.values.length);
    try { await apiFetch("/api/v1/product-families", { csrfToken: await csrf(), init: { method: "POST", body: JSON.stringify({ name, options }) } }); setName(""); setMessage("Family created."); await queryClient.invalidateQueries({ queryKey: ["product-families"] }); }
    catch (error) { setMessage(error instanceof ApiError ? `${error.code}: ${error.message}` : "Family create failed."); }
  }
  async function createVariant(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!selectedId || !detailQuery.data) return;
    const optionValueIds = detailQuery.data.options?.map((option) => selectedValues[option.id]).filter((value): value is string => Boolean(value)) ?? [];
    try { await apiFetch(`/api/v1/product-families/${selectedId}/variants`, { csrfToken: await csrf(), init: { method: "POST", body: JSON.stringify({ sku, priceMinor: Math.round(Number(price) * 100), optionValueIds }) } }); setMessage("Variant created."); setSku(""); setPrice(""); await queryClient.invalidateQueries({ queryKey: ["product-family", selectedId] }); }
    catch (error) { setMessage(error instanceof ApiError ? `${error.code}: ${error.message}` : "Variant create failed."); }
  }
  return <AppShell><main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6"><PageHeader eyebrow="Catalog / Product families" title="Variants" description="Define option sets once, then create normal stock-bearing SKU variants." actions={<GhostButton type="button" onClick={() => window.location.assign("/products/labels")}>Barcode labels →</GhostButton>} />
    {message ? <p role="status" className="rounded-xl border border-[#cfe9dc] bg-[#eaf7f0] px-4 py-3 text-sm text-[#1f8a5b]">{message}</p> : null}
    <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]"><Panel className="p-5"><SectionHeader title="New family" description="Use `Size:S|M;Color:Black|White` for option values." /><form onSubmit={(event) => void createFamily(event)} className="mt-4 space-y-3"><input aria-label="Family name" value={name} onChange={(event) => setName(event.target.value)} className="field" placeholder="Family name" required /><textarea aria-label="Family options" value={optionsText} onChange={(event) => setOptionsText(event.target.value)} className="field min-h-24" /><PrimaryButton type="submit">Create family</PrimaryButton></form></Panel>
      <Panel className="p-5"><SectionHeader title="Families" description="Select a family to add and review its variants." /><div className="mt-4 space-y-2">{familiesQuery.data?.items.map((family) => <button key={family.id} type="button" onClick={() => setSelectedId(family.id)} className={`block w-full rounded-xl border px-4 py-3 text-left ${selectedId === family.id ? "border-[#f35d3f] bg-[#fff3ee]" : "border-[#e4d9d0]"}`}><span className="font-semibold">{family.name}</span><span className="ml-2 text-xs text-[#73685f]">{family.brand ?? ""}</span></button>)}{familiesQuery.data?.items.length === 0 ? <p className="text-sm text-[#73685f]">No families yet.</p> : null}</div></Panel></div>
    {detailQuery.data ? <Panel className="p-5"><SectionHeader title={`${detailQuery.data.name} variants`} description="Each variant is a regular product with its own SKU and inventory." /><form onSubmit={(event) => void createVariant(event)} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">{detailQuery.data.options?.map((option) => <label key={option.id} className="text-[11px] font-semibold text-[#655b53]">{option.name}<select className="field mt-1.5" value={selectedValues[option.id] ?? ""} onChange={(event) => setSelectedValues((current) => ({ ...current, [option.id]: event.target.value }))}><option value="">Choose…</option>{option.values.map((value) => <option key={value.id} value={value.id}>{value.value}</option>)}</select></label>)}<label className="text-[11px] font-semibold text-[#655b53]">SKU<input className="field mt-1.5" value={sku} onChange={(event) => setSku(event.target.value)} required /></label><label className="text-[11px] font-semibold text-[#655b53]">Price<input className="field mt-1.5" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} required /></label><PrimaryButton type="submit" className="self-end">Add variant</PrimaryButton></form><div className="mt-5 grid gap-2 sm:grid-cols-2">{detailQuery.data.variants?.map((variant) => <div key={variant.product.id} className="rounded-lg border border-[#e4d9d0] px-3 py-2 text-sm"><span className="font-semibold">{variant.product.name}</span><span className="ml-2 font-data text-[#73685f]">{variant.product.sku ?? "—"}</span></div>)}</div></Panel> : null}
  </main></AppShell>;
}
