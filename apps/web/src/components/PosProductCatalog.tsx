import React, { useRef, useState, type ReactNode } from "react";
import Image from "next/image";

import { minorToMajorFixed } from "../lib/money";
import { validProductImageUrl } from "../lib/product-image";
import type { PosProduct } from "../lib/pos-sale-model";
import { productInitials, productTileClass } from "../lib/pos-view";
import { PosQuantityDialog } from "./PosQuantityDialog";

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
  onAddProduct: (product: PosProduct, quantity?: number) => void;
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
  const [pendingProduct, setPendingProduct] = useState<PosProduct | null>(null);
  const quantityTrigger = useRef<HTMLButtonElement | null>(null);
  function closeQuantity(): void {
    setPendingProduct(null);
    quantityTrigger.current?.focus();
  }
  return (
    <section aria-label="Products" className="min-w-0 p-4 lg:max-xl:flex lg:max-xl:h-full lg:max-xl:flex-col lg:max-xl:px-7 lg:max-xl:pb-7 lg:max-xl:pt-6 xl:relative xl:flex xl:h-full xl:min-h-[820px] xl:flex-col xl:p-[24px] xl:pr-[26px]">
      <div className="hidden xl:mb-7 xl:block">
        <h1 className="font-display text-[26px] font-semibold text-[#202826]">Products</h1>
        <p className="mt-1 text-[13px] text-[#71807a]">Choose a quantity before adding to this sale.</p>
      </div>
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
            className="field-dark !h-[54px] !rounded-xl !py-3 pl-10 xl:!rounded-[9px] xl:!border-[#e5e9e3] xl:!bg-white xl:!text-[#202826] xl:placeholder:text-[#71807a]"
          />
          <span aria-hidden className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35 xl:text-[#71807a]">⌕</span>
          <kbd className="absolute right-3.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-white/15 px-1.5 py-0.5 text-[10px] text-white/40 xl:block xl:border-[#e5e9e3] xl:text-[#71807a]">Ctrl K</kbd>
        </div>
        <button
          type="button"
          onClick={() => document.getElementById("pos-search")?.focus()}
          className="hidden h-[54px] w-[82px] shrink-0 rounded-xl bg-[#f35d3f] text-[10px] font-semibold text-white shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] hover:bg-[#d94a30] xl:block"
        >
          Scan F2
        </button>
      </form>

      <div className="mt-4 flex min-h-[34px] flex-nowrap items-center gap-2 overflow-x-auto lg:max-xl:mt-[18px] lg:max-xl:gap-[22px] xl:mt-7 xl:gap-3">
        <button
          type="button"
          onClick={() => onCategoryChange("")}
          aria-pressed={activeCategoryId === ""}
          className={
            "h-[34px] shrink-0 rounded-[17px] border px-3 text-[8px] font-semibold lg:max-xl:mr-[30px] lg:max-xl:w-20 xl:mr-0 xl:w-[130px] xl:rounded-[7px] xl:text-[12px] " +
            (activeCategoryId === ""
              ? "border-[#ffb7a4] bg-[#ffb7a4] text-[#4a2118] xl:border-[#202826] xl:bg-[#202826] xl:text-white"
              : "border-[#3a3732] bg-[#252422] text-[#d5cdc6] xl:border-[#eff2ef] xl:bg-[#eff2ef] xl:text-[#202826]")
          }
        >
          <span className="lg:max-xl:inline xl:hidden">All items</span>
          <span className="hidden xl:inline">All products</span>
        </button>
        {categories.filter((category) => category.isActive).map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => onCategoryChange(category.id)}
            aria-pressed={activeCategoryId === category.id}
            className={
              "h-[34px] shrink-0 rounded-[17px] border px-3 text-[8px] font-semibold lg:max-xl:w-[110px] xl:w-[130px] xl:rounded-[7px] xl:text-[12px] " +
              (activeCategoryId === category.id
                ? "border-[#ffb7a4] bg-[#ffb7a4] text-[#4a2118] xl:border-[#202826] xl:bg-[#202826] xl:text-white"
                : "border-[#3a3732] bg-[#252422] text-[#d5cdc6] xl:border-[#eff2ef] xl:bg-[#eff2ef] xl:text-[#202826]")
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

      {loading ? <p className="mt-4 text-sm text-white/50 xl:text-[#71807a]">Loading products…</p> : null}
      {!offline && !loading && products.length === 0 ? (
        <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-6 text-center text-sm text-white/50 xl:border-[#e5e9e3] xl:bg-white xl:text-[#71807a]">No products found.</p>
      ) : null}
      <ul className="mt-5 grid content-start grid-cols-2 gap-3 sm:grid-cols-3 lg:max-xl:mt-[22px] lg:max-xl:min-h-0 lg:max-xl:flex-1 lg:max-xl:grid-cols-[repeat(3,280px)] lg:max-xl:overflow-y-auto lg:max-xl:pb-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[repeat(auto-fill,minmax(215px,1fr))] xl:gap-3 xl:overflow-y-auto xl:pb-24">
        {products.map((product, index) => {
          const selected = selectedProductIds.has(product.id);
          return (
            <li key={product.id} className="relative" style={{ animation: `rise 0.35s ${Math.min(index * 0.02, 0.25)}s both` }}>
              <button
                type="button"
                onClick={() => onAddProduct(product)}
                disabled={saleLocked}
                className={
                  "card-hover relative w-full rounded-xl border bg-[#252422] p-3 text-left disabled:cursor-not-allowed disabled:opacity-55 lg:max-xl:h-[220px] lg:max-xl:p-[13px] xl:h-[152px] xl:rounded-[9px] xl:bg-white xl:p-[11px] xl:text-[#202826] xl:shadow-sm " +
                  (selected ? "border-[#ff765a] xl:border-[#da614c]" : "border-[#35312d] xl:border-[#e5e9e3]")
                }
              >
                <span
                  data-ui="product-visual"
                  className={
                    "font-display relative flex h-16 items-center overflow-hidden rounded-[9px] px-[14px] text-2xl font-extrabold text-white/95 lg:max-xl:absolute lg:max-xl:left-[13px] lg:max-xl:top-[13px] lg:max-xl:h-[100px] lg:max-xl:w-[252px] lg:max-xl:px-4 xl:absolute xl:left-[11px] xl:top-[11px] xl:h-[73px] xl:w-[78px] xl:text-[20px] " +
                    (selected ? "bg-[#4a2118]" : productTileClass(product.name))
                  }
                  aria-hidden
                >
                  {productInitials(product.name)}
                  {product.imageUrl && validProductImageUrl(product.imageUrl) ? (
                    <Image unoptimized src={product.imageUrl} alt="" fill
                      sizes="(min-width: 1280px) 152px, (min-width: 1024px) 252px, 50vw"
                      className="object-cover" />
                  ) : null}
                </span>
                <span className="mt-2.5 block truncate text-[13.5px] font-semibold lg:max-xl:absolute lg:max-xl:left-[13px] lg:max-xl:top-[131px] lg:max-xl:mt-0 lg:max-xl:max-w-[252px] lg:max-xl:text-[12px] xl:absolute xl:left-[103px] xl:top-[20px] xl:mt-0 xl:max-w-[calc(100%-112px)] xl:text-[12px]">{product.name}</span>
                <span className="money absolute bottom-3 left-3 block text-[13px] font-bold text-white/85 lg:max-xl:left-[13px] lg:max-xl:top-[185px] lg:max-xl:bottom-auto lg:max-xl:text-[11px] xl:left-[11px] xl:top-[120px] xl:bottom-auto xl:text-[15px] xl:text-[#202826]">₱{money(product.priceMinor)}</span>
                <span data-ui="product-add" aria-hidden className="absolute hidden h-7 w-7 place-items-center rounded-lg bg-[#f35d3f] text-[18px] font-semibold text-[#211814] xl:left-[135px] xl:top-[81px] xl:grid">+</span>
              </button>
              <button type="button" aria-label={`Set qty for ${product.name}`} disabled={saleLocked}
                onClick={(event) => {
                  quantityTrigger.current = event.currentTarget;
                  setPendingProduct(product);
                }}
                className="absolute bottom-2.5 right-2.5 z-10 min-h-9 rounded-lg border border-[#ffb7a4]/50 bg-[#4a2118] px-2.5 text-[10px] font-semibold text-[#ffb7a4] shadow-sm hover:border-[#f35d3f] hover:bg-[#6b3023] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffb7a4] disabled:opacity-35 xl:min-h-[30px] xl:border-[#eff2ef] xl:bg-[#eff2ef] xl:text-[#202826] xl:hover:border-[#d4ded7] xl:hover:bg-[#e5e9e3]">
                Set qty
              </button>
            </li>
          );
        })}
      </ul>

      <div className="hidden xl:absolute xl:bottom-[18px] xl:left-[24px] xl:right-[26px] xl:flex xl:items-center xl:gap-2 xl:rounded-xl xl:border xl:border-[#e5e9e3] xl:bg-white xl:p-3">
        <span className="mr-auto text-[11px] font-semibold text-[#71807a]">⚡ Quick actions</span>
        <button
          type="button"
          onClick={onAssignCustomer}
          disabled={saleLocked}
          className="rounded-lg border border-[#e5e9e3] bg-[#eff2ef] px-5 py-2 text-[10px] font-semibold text-[#202826] hover:bg-[#e5e9e3]"
        >
          Add customer <span className="font-data text-white/35">F1</span>
        </button>
      </div>
      {connectivityBanner}
      {pendingProduct && !saleLocked ? (
        <PosQuantityDialog product={pendingProduct}
          onAdd={(quantity) => {
            onAddProduct(pendingProduct, quantity);
            closeQuantity();
          }}
          onClose={closeQuantity} />
      ) : null}
    </section>
  );
}
