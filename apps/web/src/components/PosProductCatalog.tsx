import React, { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";

import { minorToMajorFixed } from "../lib/money";
import type { PosProduct } from "../lib/pos-sale-model";
import { validProductImageUrl } from "../lib/product-image";
import { productInitials, productTileClass } from "../lib/pos-view";

interface RegisterOption {
  id: string;
  name: string;
  isActive: boolean;
}

interface CategoryOption {
  id: string;
  name: string;
  isActive: boolean;
}

interface PosProductCatalogProps {
  registerId: string;
  registers: RegisterOption[];
  query: string;
  activeCategoryId: string;
  categories: CategoryOption[];
  products: PosProduct[];
  selectedProductIds: Set<string>;
  loading: boolean;
  offline: boolean;
  saleLocked: boolean;
  catalogAt: string | null;
  connectivityBanner: ReactNode;
  onRegisterChange: (registerId: string) => void;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  onCategoryChange: (categoryId: string) => void;
  onAddProduct: (product: PosProduct, quantity: number) => void;
  onAssignCustomer: () => void;
}

function money(minor: number): string {
  return minorToMajorFixed(minor);
}

export function PosProductCatalog({
  registerId,
  registers,
  query,
  activeCategoryId,
  categories,
  products,
  selectedProductIds,
  loading,
  offline,
  saleLocked,
  catalogAt,
  connectivityBanner,
  onRegisterChange,
  onQueryChange,
  onSearch,
  onCategoryChange,
  onAddProduct,
  onAssignCustomer,
}: PosProductCatalogProps) {
  const [selectedProduct, setSelectedProduct] = useState<PosProduct | null>(null);
  const [quantity, setQuantity] = useState("1");
  const quantityDialog = useRef<HTMLDialogElement>(null);
  const quantityInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const dialog = quantityDialog.current;
    if (!dialog) return;
    if (selectedProduct && !dialog.open) {
      dialog.showModal();
      quantityInput.current?.focus();
    }
    if (!selectedProduct && dialog.open) dialog.close();
  }, [selectedProduct]);

  function selectProduct(product: PosProduct): void {
    setQuantity("1");
    setSelectedProduct(product);
  }

  function confirmProduct(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const pieces = Number(quantity);
    if (!selectedProduct || !Number.isSafeInteger(pieces) || pieces < 1 || pieces > 9999) return;
    onAddProduct(selectedProduct, pieces);
    setSelectedProduct(null);
  }

  return (
    <section aria-label="Products" className="min-w-0 p-4 lg:max-xl:flex lg:max-xl:h-full lg:max-xl:flex-col lg:max-xl:px-7 lg:max-xl:pb-7 lg:max-xl:pt-6 xl:relative xl:flex xl:h-[866px] xl:flex-col xl:p-[18px] xl:pr-0">
      <label className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-semibold text-white/70 md:hidden">
        Register
        <select
          aria-label="Mobile register"
          value={registerId}
          onChange={(event) => onRegisterChange(event.target.value)}
          disabled={saleLocked}
          className="min-w-0 max-w-[190px] rounded-lg border border-white/10 bg-[#252422] px-2 py-2 text-[10px] font-semibold text-white outline-none"
        >
          <option value="">Select register</option>
          {registers.filter((register) => register.isActive).map((register) => (
            <option key={register.id} value={register.id}>{register.name}</option>
          ))}
        </select>
      </label>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
        className="flex gap-2.5"
      >
        <div className="relative min-w-0 flex-1">
          <label className="sr-only" htmlFor="pos-search">Search product, SKU or scan barcode</label>
          <input
            id="pos-search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search product, SKU or scan barcode…"
            autoFocus
            className="field-dark !h-[54px] !rounded-xl !py-3 pl-10"
          />
          <span aria-hidden className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35">⌕</span>
          <kbd className="absolute right-3.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-white/15 px-1.5 py-0.5 text-[10px] text-white/40 xl:block">Ctrl K</kbd>
        </div>
        <button
          type="button"
          onClick={() => document.getElementById("pos-search")?.focus()}
          className="hidden h-[54px] w-[82px] shrink-0 rounded-xl bg-[#f35d3f] text-[10px] font-semibold text-white shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] hover:bg-[#d94a30] xl:block"
        >
          Scan F2
        </button>
      </form>

      <div className="mt-4 flex min-h-[34px] flex-nowrap items-center gap-2 overflow-x-auto lg:max-xl:mt-[18px] lg:max-xl:gap-[22px]">
        <button
          type="button"
          onClick={() => onCategoryChange("")}
          aria-pressed={activeCategoryId === ""}
          className={
            "h-[34px] shrink-0 rounded-[17px] border px-3 text-[8px] font-semibold lg:max-xl:mr-[30px] lg:max-xl:w-20 xl:mr-8 xl:w-[58px] " +
            (activeCategoryId === ""
              ? "border-[#ffb7a4] bg-[#ffb7a4] text-[#4a2118]"
              : "border-[#3a3732] bg-[#252422] text-[#d5cdc6]")
          }
        >
          <span className="lg:max-xl:inline xl:hidden">All items</span>
          <span className="hidden xl:inline">All</span>
        </button>
        {categories.filter((category) => category.isActive).map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => onCategoryChange(category.id)}
            aria-pressed={activeCategoryId === category.id}
            className={
              "h-[34px] shrink-0 rounded-[17px] border px-3 text-[8px] font-semibold lg:max-xl:w-[110px] xl:w-[90px] " +
              (activeCategoryId === category.id
                ? "border-[#ffb7a4] bg-[#ffb7a4] text-[#4a2118]"
                : "border-[#3a3732] bg-[#252422] text-[#d5cdc6]")
            }
          >
            <span className="block truncate">{category.name}</span>
          </button>
        ))}
        {offline ? (
          <span className="rounded-full bg-amber-500/15 px-3 py-1.5 text-[11.5px] font-medium text-amber-300">
            Offline catalog{catalogAt ? ` as of ${catalogAt}` : " (never synced)"}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onAssignCustomer}
          disabled={saleLocked}
          className="ml-auto rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-white/65 hover:text-white lg:hidden"
        >
          Customer
        </button>
      </div>

      {loading ? <p className="mt-4 text-sm text-white/50">Loading products…</p> : null}
      {!offline && !loading && products.length === 0 ? (
        <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-6 text-center text-sm text-white/50">No products found.</p>
      ) : null}
      <ul className="mt-5 grid content-start grid-cols-2 gap-3 sm:grid-cols-3 lg:max-xl:mt-[22px] lg:max-xl:min-h-0 lg:max-xl:flex-1 lg:max-xl:grid-cols-[repeat(3,280px)] lg:max-xl:overflow-y-auto lg:max-xl:pb-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[repeat(auto-fill,minmax(164px,1fr))] xl:gap-2 xl:overflow-y-auto xl:pb-24">
        {products.map((product, index) => {
          const selected = selectedProductIds.has(product.id);
          return (
            <li key={product.id} style={{ animation: `rise 0.35s ${Math.min(index * 0.02, 0.25)}s both` }}>
              <button
                type="button"
                onClick={() => selectProduct(product)}
                aria-description="Choose quantity before adding to the sale"
                disabled={saleLocked}
                className={
                  "card-hover relative w-full rounded-xl border bg-[#252422] p-3 text-left disabled:cursor-not-allowed disabled:opacity-55 lg:max-xl:h-[220px] lg:max-xl:p-[13px] xl:h-[152px] xl:p-[11px] " +
                  (selected ? "border-[#ff765a]" : "border-[#35312d]")
                }
              >
                <span
                  data-ui="product-visual"
                  className={
                    "font-display relative flex h-16 items-center overflow-hidden rounded-[9px] px-[14px] text-2xl font-extrabold text-white/95 lg:max-xl:absolute lg:max-xl:left-[13px] lg:max-xl:top-[13px] lg:max-xl:h-[100px] lg:max-xl:w-[252px] lg:max-xl:px-4 xl:absolute xl:left-[11px] xl:top-[11px] xl:h-[62px] xl:w-[152px] xl:text-[20px] " +
                    (selected ? "bg-[#4a2118]" : productTileClass(product.name))
                  }
                  aria-hidden
                >
                  {productInitials(product.name)}
                  {product.imageUrl && validProductImageUrl(product.imageUrl) ? (
                    <Image unoptimized src={product.imageUrl} alt="" fill sizes="(min-width: 1280px) 152px, (min-width: 1024px) 252px, 50vw" className="object-cover" />
                  ) : null}
                </span>
                <span className="mt-2.5 block truncate text-[13.5px] font-semibold lg:max-xl:absolute lg:max-xl:left-[13px] lg:max-xl:top-[131px] lg:max-xl:mt-0 lg:max-xl:max-w-[252px] lg:max-xl:text-[12px] xl:absolute xl:left-[11px] xl:top-[83px] xl:mt-0 xl:max-w-[120px] xl:text-[10px]">{product.name}</span>
                <span className="money absolute bottom-3 left-3 block text-[13px] font-bold text-white/85 lg:max-xl:left-[13px] lg:max-xl:top-[185px] lg:max-xl:bottom-auto lg:max-xl:text-[11px] xl:left-[11px] xl:top-[125px] xl:bottom-auto xl:text-[10px]">₱{money(product.priceMinor)}</span>
                <span data-ui="product-add" aria-hidden className="absolute hidden h-7 w-7 place-items-center rounded-lg bg-[#f35d3f] text-[18px] font-semibold text-[#211814] xl:left-[135px] xl:top-[113px] xl:grid">+</span>
              </button>
            </li>
          );
        })}
      </ul>

      <dialog
        ref={quantityDialog}
        onCancel={(event) => { event.preventDefault(); setSelectedProduct(null); }}
        onClose={() => setSelectedProduct(null)}
        aria-labelledby="pos-quantity-title"
        className="m-auto w-[min(92vw,390px)] rounded-2xl border border-[#3b3732] bg-[#252422] p-0 text-white shadow-2xl backdrop:bg-black/65"
      >
        {selectedProduct ? (
          <form onSubmit={confirmProduct} className="space-y-5 p-6">
            <div>
              <h2 id="pos-quantity-title" className="font-display text-xl font-semibold">Choose pieces</h2>
              <p className="mt-2 text-sm text-white/75">{selectedProduct.name}</p>
              <p className="mt-1 text-xs text-white/55">₱{money(selectedProduct.priceMinor)} per piece</p>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setQuantity((value) => String(Math.max(1, (Number(value) || 1) - 1)))} aria-label="Decrease pieces" className="grid h-12 w-12 place-items-center rounded-xl border border-white/20 text-xl">−</button>
              <input
                ref={quantityInput}
                type="number"
                inputMode="numeric"
                min={1}
                max={9999}
                step={1}
                required
                aria-label="Pieces"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="h-12 min-w-0 flex-1 rounded-xl border border-white/20 bg-[#171614] text-center font-data text-lg text-white focus-visible:outline-2 focus-visible:outline-[#ff9a82]"
              />
              <button type="button" onClick={() => setQuantity((value) => String(Math.min(9999, (Number(value) || 0) + 1)))} aria-label="Increase pieces" className="grid h-12 w-12 place-items-center rounded-xl border border-white/20 text-xl">+</button>
            </div>
            <p aria-live="polite" className="text-sm text-white/70">Line total: ₱{money(selectedProduct.priceMinor * (Number.isSafeInteger(Number(quantity)) && Number(quantity) > 0 && Number(quantity) <= 9999 ? Number(quantity) : 0))}</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setSelectedProduct(null)} className="min-h-12 flex-1 rounded-xl border border-white/20 text-sm font-semibold">Cancel</button>
              <button type="submit" className="min-h-12 flex-1 rounded-xl bg-[#f35d3f] text-sm font-semibold text-white hover:bg-[#d94a30]">Add to sale</button>
            </div>
          </form>
        ) : null}
      </dialog>

      <div className="hidden xl:absolute xl:bottom-[18px] xl:left-[18px] xl:right-[18px] xl:flex xl:items-center xl:gap-2 xl:rounded-xl xl:border xl:border-white/10 xl:bg-[#252422] xl:p-3">
        <span className="mr-auto text-[11px] font-semibold text-white/70">⚡ Quick actions</span>
        <button
          type="button"
          onClick={onAssignCustomer}
          disabled={saleLocked}
          className="rounded-lg border border-white/10 bg-white/[0.04] px-5 py-2 text-[10px] font-semibold text-white/75 hover:bg-white/[0.08] hover:text-white"
        >
          Add customer <span className="font-data text-white/35">F1</span>
        </button>
      </div>
      {connectivityBanner}
    </section>
  );
}
