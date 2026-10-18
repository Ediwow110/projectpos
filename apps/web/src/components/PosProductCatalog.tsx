import React, { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";

import { minorToMajorFixed } from "../lib/money";

import type { PosProduct } from "../lib/pos-sale-model";
import { validProductImageUrl } from "../lib/product-image";
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
  atlasV4?: boolean;
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
  atlasV4 = false,
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
    if (!selectedProduct || !Number.isSafeInteger(pieces) || pieces < 1 || pieces > 999) return;
    onAddProduct(selectedProduct, pieces);
    setSelectedProduct(null);
  }

  if (atlasV4) return (
    <section aria-label="Products" data-ui="atlas-pos-products" className="flex min-h-0 min-w-0 flex-col bg-[#f7f8f5] px-4 pb-8 pt-7 sm:px-7 xl:px-[34px]">
      <header className="mb-5">
        <h2 className="font-display text-[25px] font-semibold text-[#202826]">Products</h2>
        <p className="mt-1 text-[13px] text-[#53615a]">Choose a quantity before adding to this sale.</p>
      </header>
      <form onSubmit={(event) => { event.preventDefault(); onSearch(); }} className="flex gap-2">
        <label htmlFor="pos-search" className="sr-only">Search product, SKU or scan barcode</label>
        <input id="pos-search" autoFocus value={query} onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search product, SKU or scan barcode…"
          className="h-[54px] min-w-0 flex-1 rounded-[9px] border border-[#e5e9e3] bg-white px-4 text-sm text-[#202826] placeholder:text-[#53615a] focus-visible:outline-2 focus-visible:outline-[#267552]" />
        <button type="submit" className="min-h-11 rounded-[9px] bg-[#202826] px-4 text-xs font-semibold text-white">Search</button>
      </form>
      <label className="mt-3 inline-flex items-center gap-3 text-xs text-[#53615a] md:hidden">
        Register
        <select aria-label="Mobile register" value={registerId} disabled={saleLocked} onChange={(event) => onRegisterChange(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-lg border border-[#dce3dc] bg-white px-3 text-[#202826]">
          <option value="">Select register</option>
          {registers.filter((r) => r.isActive).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      <div className="mt-6 flex min-h-11 items-center gap-2 overflow-x-auto pb-1">
        <button type="button" aria-pressed={activeCategoryId === ""} onClick={() => onCategoryChange("")}
          className={"min-h-[35px] min-w-[112px] shrink-0 rounded-[7px] px-3 text-xs font-medium sm:min-w-[125px] " + (activeCategoryId === "" ? "bg-[#202826] text-white" : "bg-[#eff2ed] text-[#202826]")}>All products</button>
        {categories.filter((c) => c.isActive).map((c) => <button key={c.id} type="button" aria-pressed={activeCategoryId === c.id} onClick={() => onCategoryChange(c.id)}
          className={"min-h-[35px] min-w-[112px] shrink-0 rounded-[7px] px-3 text-xs font-medium sm:min-w-[125px] " + (activeCategoryId === c.id ? "bg-[#202826] text-white" : "bg-[#eff2ed] text-[#202826]")}>{c.name}</button>)}
        <button type="button" onClick={onAssignCustomer} disabled={saleLocked} className="ml-auto min-h-[35px] shrink-0 rounded-[7px] bg-[#eff2ed] px-3 text-xs text-[#202826] xl:hidden">Customer</button>
      </div>
      {offline ? <p role="status" className="mt-3 rounded-lg bg-[#fff4df] px-3 py-2 text-xs text-[#946c31]">Offline catalog{catalogAt ? ` as of ${catalogAt}` : " (never synced)"}</p> : null}
      {loading ? <p role="status" className="mt-4 text-sm text-[#53615a]">Loading products…</p> : null}
      {!offline && !loading && products.length === 0 ? <p className="mt-4 rounded-xl border border-[#e5e9e3] bg-white p-6 text-center text-sm text-[#53615a]">No products found.</p> : null}
      <ul className="mt-4 grid min-w-0 content-start grid-cols-2 gap-3 sm:grid-cols-3 xl:gap-4">
        {products.map((product) => <li key={product.id} className="min-w-0">
          <button type="button" disabled={saleLocked} aria-label={`${product.name} ₱${money(product.priceMinor)}`} aria-description="Choose quantity before adding to the sale" onClick={() => selectProduct(product)}
            className={"flex h-[166px] w-full min-w-0 flex-col rounded-[10px] border bg-white p-[13px] text-left shadow-[0_3px_11px_rgba(20,38,31,0.04)] transition-colors hover:border-[#da614c] focus-visible:outline-2 focus-visible:outline-[#da614c] disabled:opacity-50 xl:h-[151px] " + (selectedProductIds.has(product.id) ? "border-[#da614c]" : "border-[#e5e9e3]")}>
            <span className="flex min-w-0 items-center gap-3">
              <span data-ui="product-visual" aria-hidden className={"relative grid size-[73px] shrink-0 place-items-center overflow-hidden rounded-[8px] font-display text-xl font-semibold text-white " + productTileClass(product.name)}>
                {productInitials(product.name)}
                {product.imageUrl && validProductImageUrl(product.imageUrl) ? <Image unoptimized src={product.imageUrl} alt="" fill sizes="78px" className="object-cover" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-[13px] font-medium text-[#202826]">{product.name}</span>
                <span className="mt-2 block truncate text-[11px] text-[#53615a]">{product.sku ? `SKU ${product.sku}` : "Choose pieces"}</span>
              </span>
            </span>
            <span className="mt-auto flex items-center justify-between border-t border-[#e4e9e3] pt-2.5">
              <strong className="font-display text-[16px] font-semibold text-[#202826]">₱{money(product.priceMinor)}</strong>
              <span className="rounded-[8px] bg-[#eff2ed] px-3 py-1.5 text-[12px] text-[#202826]">Set qty</span>
            </span>
          </button>
        </li>)}
      </ul>
      {connectivityBanner}
      <dialog ref={quantityDialog} onCancel={(event) => { event.preventDefault(); setSelectedProduct(null); }} onClose={() => setSelectedProduct(null)} aria-labelledby="pos-quantity-title"
        className="m-auto w-[min(92vw,430px)] rounded-[14px] border border-[#e5e9e3] bg-white p-0 text-[#202826] shadow-2xl backdrop:bg-black/45">
        {selectedProduct ? <form onSubmit={confirmProduct} className="space-y-5 p-6">
          <div><h2 id="pos-quantity-title" className="font-display text-xl font-semibold">Choose pieces</h2><p className="mt-2 text-sm text-[#53615a]">{selectedProduct.name} · ₱{money(selectedProduct.priceMinor)} each</p></div>
          <div className="flex items-center gap-3">
            <button type="button" aria-label="Decrease pieces" onClick={() => setQuantity((q) => String(Math.max(1, (Number(q) || 1) - 1)))} className="grid size-12 place-items-center rounded-lg bg-[#eff2ed] text-xl">−</button>
            <input ref={quantityInput} type="number" inputMode="numeric" min={1} max={999} step={1} required aria-label="Pieces" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-12 min-w-0 flex-1 rounded-lg border border-[#dce3dc] text-center font-data text-xl focus-visible:outline-2 focus-visible:outline-[#267552]" />
            <button type="button" aria-label="Increase pieces" onClick={() => setQuantity((q) => String(Math.min(999, (Number(q) || 0) + 1)))} className="grid size-12 place-items-center rounded-lg bg-[#eff2ed] text-xl">+</button>
          </div>
          <p aria-live="polite" className="text-sm text-[#53615a]">Line total: ₱{money(selectedProduct.priceMinor * (Number.isSafeInteger(Number(quantity)) && Number(quantity) > 0 && Number(quantity) <= 999 ? Number(quantity) : 0))}</p>
          <div className="flex gap-3"><button type="button" onClick={() => setSelectedProduct(null)} className="min-h-12 flex-1 rounded-lg bg-[#eff2ed] text-sm font-semibold">Cancel</button><button type="submit" className="min-h-12 flex-1 rounded-lg bg-[#b84f3c] text-sm font-semibold text-white">Add to sale</button></div>
        </form> : null}
      </dialog>
    </section>
  );

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
                onClick={(event) => { quantityTrigger.current = event.currentTarget; setPendingProduct(product); }}
                aria-description="Choose quantity before adding to the sale"
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
