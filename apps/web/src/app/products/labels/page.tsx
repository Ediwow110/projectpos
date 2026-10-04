"use client";

import { useState, type JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../../../components/AppShell";
import { PageHeader, Panel, SectionHeader } from "../../../components/premium";
import { GhostButton, PrimaryButton } from "../../../components/ui";
import { apiFetch, ApiError } from "../../../lib/api";

interface LabelProduct {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  priceMinor: number;
  labelQuantity: number;
}

function bars(value: string): string {
  return Array.from(value).map((character, index) => {
    const code = character.charCodeAt(0) + index * 17;
    return Array.from({ length: (code % 4) + 1 }, (_, bar) => (bar % 2 === 0 ? "1" : "0")).join("");
  }).join("101");
}

function Label({ product }: { product: LabelProduct }): JSX.Element {
  const pattern = bars(product.barcode ?? product.sku ?? product.id);
  return (
    <article className="label-card rounded-lg border border-[#d9cec4] bg-white p-3 text-center text-[#241f1b]">
      <p className="truncate text-[11px] font-semibold">{product.name}</p>
      <svg aria-label={`Barcode for ${product.name}`} role="img" viewBox={`0 0 ${pattern.length} 42`} className="mx-auto mt-2 h-12 w-full">
        {Array.from(pattern).map((bit, index) => bit === "1" ? <rect key={index} x={index} y="0" width="1" height="42" fill="currentColor" /> : null)}
      </svg>
      <p className="font-data mt-1 text-[10px] tracking-[0.16em]">{product.barcode ?? "NO BARCODE"}</p>
      <p className="font-data mt-1 text-[10px]">₱{(product.priceMinor / 100).toFixed(2)}</p>
    </article>
  );
}

export default function ProductLabelsPage(): JSX.Element {
  const [productIds, setProductIds] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [request, setRequest] = useState<{ ids: string; quantity: number } | null>(null);
  const labelsQuery = useQuery({
    queryKey: ["product-labels", request],
    enabled: request !== null,
    queryFn: () => apiFetch<{ items: LabelProduct[] }>(`/api/v1/products/labels?productIds=${encodeURIComponent(request!.ids)}&quantity=${request!.quantity}`),
    retry: false,
  });
  const loadLabels = (event: React.FormEvent): void => {
    event.preventDefault();
    const ids = productIds.split(",").map((id) => id.trim()).filter(Boolean).join(",");
    const count = Number(quantity);
    if (ids && Number.isInteger(count) && count > 0 && count <= 100) setRequest({ ids, quantity: count });
  };
  const labels = labelsQuery.data?.items.flatMap((product) => Array.from({ length: product.labelQuantity }, () => product)) ?? [];
  return (
    <AppShell>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader eyebrow="Catalog / Barcode labels" title="Barcode labels" description="Preview a clean, print-ready sheet for selected products." actions={<GhostButton type="button" onClick={() => window.print()} disabled={labels.length === 0}>Print labels</GhostButton>} />
        <Panel className="p-5 print:hidden">
          <SectionHeader title="Label set" description="Paste product IDs separated by commas. Labels preserve the product barcode, including leading zeros." />
          <form onSubmit={loadLabels} className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_140px_auto]">
            <label className="text-[11px] font-semibold text-[#655b53]">Product IDs<input value={productIds} onChange={(event) => setProductIds(event.target.value)} className="field mt-1.5" placeholder="id-1,id-2" /></label>
            <label className="text-[11px] font-semibold text-[#655b53]">Copies<input type="number" min={1} max={100} value={quantity} onChange={(event) => setQuantity(event.target.value)} className="field mt-1.5" /></label>
            <PrimaryButton type="submit" className="self-end">Preview labels</PrimaryButton>
          </form>
          {labelsQuery.isError ? <p role="alert" className="mt-3 text-sm text-[#b33d32]">{labelsQuery.error instanceof ApiError ? `${labelsQuery.error.code}: ${labelsQuery.error.message}` : "Could not load labels."}</p> : null}
        </Panel>
        <section aria-label="Barcode label preview" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
          {labels.map((product, index) => <Label key={`${product.id}-${index}`} product={product} />)}
          {request && labels.length === 0 && !labelsQuery.isLoading ? <Panel className="col-span-full p-8 text-center text-sm text-[#73685f]">No labels to preview.</Panel> : null}
        </section>
      </main>
      <style jsx global>{`@media print { body { background: white !important; } .label-card { break-inside: avoid; } }`}</style>
    </AppShell>
  );
}
