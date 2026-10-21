"use client";

import type { JSX } from "react";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { NexposLogo } from "../../components/brand/NexposLogo";
import { ApiError, apiFetch } from "../../lib/api";
import {
  formatOrderMoney,
  newOrderIdempotencyKey,
  reconcileCartForCatalog,
  replaceWithServerTotals,
  storefrontErrorMessage,
  validatePublicCheckout,
  type CartLine,
  type OrderTotals,
  type PublicCatalogItem,
  type PublicCatalogResponse,
  type PublicFulfillmentMode,
  type PublicPaymentMethod,
  type PublicPaymentMode,
  type PublicStorefront,
} from "../../lib/orders";

type AddressState = {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  countryCode: string;
};

type SubmitResponse = {
  order: OrderTotals & { id: string; status: string; version: number };
  statusToken: string;
  checkoutUrl?: string;
  replayed: boolean;
};

const PAYMENT_METHODS: Array<{ value: PublicPaymentMethod; label: string }> = [
  { value: "card", label: "Card" },
  { value: "gcash", label: "GCash" },
  { value: "maya", label: "Maya" },
  { value: "qrph", label: "QR Ph" },
];

function OrderExperience(): JSX.Element {
  const params = useSearchParams();
  const storefrontKey = params.get("storefront")?.trim() ?? "";
  const [storefront, setStorefront] = useState<PublicStorefront | null>(null);
  const [storefrontLoading, setStorefrontLoading] = useState(true);
  const [storefrontError, setStorefrontError] = useState("");
  const [fulfillmentMode, setFulfillmentMode] = useState<PublicFulfillmentMode>("PICKUP");
  const [branchId, setBranchId] = useState("");
  const [catalog, setCatalog] = useState<PublicCatalogResponse | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartNotice, setCartNotice] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [instructions, setInstructions] = useState("");
  const [address, setAddress] = useState<AddressState>({
    line1: "",
    line2: "",
    city: "",
    region: "",
    postalCode: "",
    countryCode: "PH",
  });
  const [paymentMode, setPaymentMode] = useState<PublicPaymentMode>("PAY_AT_PICKUP");
  const [paymentMethod, setPaymentMethod] = useState<PublicPaymentMethod | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverTotals, setServerTotals] = useState<OrderTotals | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const createKeyRef = useRef<string | null>(null);
  const submitAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    if (!/^[a-f0-9]{32}$/i.test(storefrontKey)) {
      setStorefrontLoading(false);
      setStorefrontError("This ordering link is incomplete.");
      return;
    }
    const controller = new AbortController();
    setStorefrontLoading(true);
    setStorefrontError("");
    void apiFetch<PublicStorefront>("/api/v1/public/storefront?key=" + encodeURIComponent(storefrontKey), {
      init: { signal: controller.signal },
    })
      .then((next) => {
        setStorefront(next);
        if (next.pickupBranches.length === 0 && next.deliveryBranch) {
          setFulfillmentMode("DELIVERY");
          setPaymentMode("PREPAID");
        }
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setStorefrontError(storefrontErrorMessage(error instanceof ApiError ? error.code : "NETWORK_ERROR"));
      })
      .finally(() => setStorefrontLoading(false));
    return () => controller.abort();
  }, [storefrontKey]);

  const branchOptions = useMemo(() => {
    if (!storefront) return [];
    if (fulfillmentMode === "PICKUP") return storefront.pickupBranches;
    return storefront.deliveryBranch ? [storefront.deliveryBranch] : [];
  }, [fulfillmentMode, storefront]);

  useEffect(() => {
    if (!branchId || !storefrontKey) {
      setCatalog(null);
      return;
    }
    const controller = new AbortController();
    setCatalogLoading(true);
    setCatalogError("");
    void apiFetch<PublicCatalogResponse>(
      "/api/v1/public/storefront/catalog?key=" + encodeURIComponent(storefrontKey)
        + "&branchId=" + encodeURIComponent(branchId)
        + "&page=1&pageSize=100",
      { init: { signal: controller.signal } },
    )
      .then((next) => {
        setCatalog(next);
        setCart((previous) => {
          const reconciled = reconcileCartForCatalog(previous, next.items);
          setCartNotice(
            reconciled.adjustedProductIds.length > 0
              ? "Your cart was adjusted to match availability at this location."
              : "",
          );
          return reconciled.lines;
        });
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setCatalogError(error instanceof ApiError ? error.message : "Could not load products for this location.");
      })
      .finally(() => setCatalogLoading(false));
    return () => controller.abort();
  }, [branchId, storefrontKey]);

  const itemById = useMemo(
    () => new Map((catalog?.items ?? []).map((item) => [item.id, item])),
    [catalog],
  );
  const cartRows = cart.flatMap((line) => {
    const item = itemById.get(line.productId);
    return item ? [{ ...line, item }] : [];
  });
  const estimatedSubtotalMinor = cartRows.reduce((sum, row) => sum + row.item.priceMinor * row.qty, 0);

  function invalidateDraft(): void {
    setDraftReady(false);
    setServerTotals(null);
    setSubmitError("");
  }

  function chooseMode(next: PublicFulfillmentMode): void {
    if (next === fulfillmentMode) return;
    setFulfillmentMode(next);
    setBranchId("");
    setCatalog(null);
    setCartNotice("");
    invalidateDraft();
    if (next === "DELIVERY") {
      setPaymentMode("PREPAID");
      if (!paymentMethod) setPaymentMethod("card");
    }
  }

  function chooseBranch(next: string): void {
    if (next === branchId) return;
    setBranchId(next);
    setCatalog(null);
    invalidateDraft();
  }

  function setLineQty(item: PublicCatalogItem, qty: number): void {
    const max = item.availableToSell === null ? 9999 : Math.max(0, Math.floor(item.availableToSell));
    const nextQty = Math.max(0, Math.min(Math.floor(qty), max));
    setCart((previous) => {
      const rest = previous.filter((line) => line.productId !== item.id);
      return nextQty > 0 ? [...rest, { productId: item.id, qty: nextQty }] : rest;
    });
    invalidateDraft();
  }

  function addItem(item: PublicCatalogItem): void {
    const current = cart.find((line) => line.productId === item.id)?.qty ?? 0;
    setLineQty(item, current + 1);
  }

  function updateAddress(field: keyof AddressState, value: string): void {
    setAddress((previous) => ({ ...previous, [field]: value }));
  }

  async function submitOrder(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!storefront || submitting) return;
    setSubmitError("");
    const deliveryAddressComplete = Boolean(
      address.line1.trim() && address.city.trim() && address.region.trim() && address.postalCode.trim(),
    );
    const errors = validatePublicCheckout({
      branchId,
      fulfillmentMode,
      paymentMode,
      paymentMethod,
      deliveryAddressComplete,
      catalogReady: catalog !== null && !catalogLoading,
    });
    if (cart.length === 0) errors.push("Add at least one product to your order.");
    if (!contactName.trim()) errors.push("Enter your name.");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.push("Enter a valid email address.");
    if (!phone.trim()) errors.push("Enter a contact number.");
    if (errors.length > 0) {
      setSubmitError(errors[0]);
      return;
    }

    const submitBody = {
      branchId,
      fulfillmentMode,
      paymentMode,
      ...(paymentMode === "PREPAID" && paymentMethod ? { paymentMethod } : {}),
      contactName: contactName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      ...(fulfillmentMode === "DELIVERY" ? {
        deliveryAddress: {
          line1: address.line1.trim(),
          ...(address.line2.trim() ? { line2: address.line2.trim() } : {}),
          city: address.city.trim(),
          region: address.region.trim(),
          postalCode: address.postalCode.trim(),
          countryCode: address.countryCode,
        },
      } : {}),
      ...(instructions.trim() ? { fulfillmentInstructions: instructions.trim() } : {}),
    };
    const fingerprint = JSON.stringify(submitBody);
    if (!submitAttemptRef.current || submitAttemptRef.current.fingerprint !== fingerprint) {
      submitAttemptRef.current = { fingerprint, key: newOrderIdempotencyKey() };
    }

    setSubmitting(true);
    try {
      let currentDraftId = draftId;
      if (!currentDraftId) {
        createKeyRef.current ??= newOrderIdempotencyKey();
        const created = await apiFetch<{ id: string }>("/api/v1/public/orders", {
          init: {
            method: "POST",
            headers: { "Idempotency-Key": createKeyRef.current },
            body: JSON.stringify({ storefrontKey }),
          },
        });
        currentDraftId = created.id;
        setDraftId(created.id);
      }
      if (!draftReady) {
        await apiFetch("/api/v1/public/orders/" + encodeURIComponent(currentDraftId) + "/draft", {
          init: {
            method: "PATCH",
            body: JSON.stringify({ branchId, fulfillmentMode, lines: cart }),
          },
        });
        setDraftReady(true);
      }
      const submitted = await apiFetch<SubmitResponse>(
        "/api/v1/public/orders/" + encodeURIComponent(currentDraftId) + "/submit",
        {
          init: {
            method: "POST",
            headers: { "Idempotency-Key": submitAttemptRef.current!.key },
            body: JSON.stringify(submitBody),
          },
        },
      );
      setServerTotals((current) => replaceWithServerTotals(
        current ?? {
          subtotalMinor: estimatedSubtotalMinor,
          discountMinor: 0,
          taxMinor: 0,
          deliveryFeeMinor: fulfillmentMode === "DELIVERY" ? storefront.deliveryFlatFeeMinor : 0,
          deliveryTaxMinor: 0,
          totalMinor: estimatedSubtotalMinor,
        },
        submitted.order,
      ));
      if (submitted.checkoutUrl) {
        window.location.assign(submitted.checkoutUrl);
        return;
      }
      window.location.assign("/order-status#token=" + encodeURIComponent(submitted.statusToken));
    } catch (error) {
      setSubmitError(
        error instanceof ApiError
          ? error.code === "PAYMENT_PROVIDER_NOT_CONFIGURED"
            ? "Online payment is temporarily unavailable. Choose pay at pickup or try again later."
            : error.message
          : "Could not submit your order. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (storefrontLoading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fcf8f3] px-6">
        <p role="status" className="font-data text-sm text-[#73685f]">Loading storefront…</p>
      </main>
    );
  }

  if (storefrontError || !storefront) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fcf8f3] px-6">
        <section className="w-full max-w-lg rounded-[16px] border border-[#eee4db] bg-white p-7 shadow-[0_16px_40px_-20px_rgb(28_20_15/0.28)]">
          <NexposLogo size="md" />
          <h1 className="font-display mt-7 text-2xl font-bold text-[#17130f]">Ordering unavailable</h1>
          <p role="alert" className="mt-3 text-sm leading-6 text-[#73685f]">{storefrontError || "This storefront is unavailable."}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#fcf8f3] text-[#17130f]">
      <header className="border-b border-[#34302c] bg-[#17130f] text-white">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <NexposLogo variant="dark" size="md" subtitle="ONLINE ORDERING" />
          <div className="min-w-0 text-right">
            <p className="truncate text-[13px] font-semibold">{storefront.name}</p>
            <p className="mt-1 font-data text-[9px] uppercase tracking-[0.12em] text-[#a79e94]">Secure first-party ordering</p>
          </div>
        </div>
      </header>

      <section className="border-b border-[#eee4db] bg-white">
        <div className="mx-auto grid max-w-[1240px] gap-5 px-5 py-6 sm:px-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <h1 className="font-display text-[30px] font-bold tracking-[-0.035em] sm:text-[38px]">Order from {storefront.name}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#73685f]">Choose how you want to receive your order, then select the store location before adding items.</p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Fulfillment method">
            <button
              type="button"
              aria-pressed={fulfillmentMode === "PICKUP"}
              disabled={storefront.pickupBranches.length === 0}
              onClick={() => chooseMode("PICKUP")}
              className={"min-h-11 rounded-[10px] border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 " + (fulfillmentMode === "PICKUP" ? "border-[#f35d3f] bg-[#fff0ea] text-[var(--color-atlas-accent-strong)]" : "border-[#e4d9d0] bg-white text-[#4d443d] hover:border-[#d5c4b7]")}
            >
              Pickup
            </button>
            <button
              type="button"
              aria-pressed={fulfillmentMode === "DELIVERY"}
              disabled={!storefront.deliveryAvailable}
              onClick={() => chooseMode("DELIVERY")}
              className={"min-h-11 rounded-[10px] border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 " + (fulfillmentMode === "DELIVERY" ? "border-[#f35d3f] bg-[#fff0ea] text-[var(--color-atlas-accent-strong)]" : "border-[#e4d9d0] bg-white text-[#4d443d] hover:border-[#d5c4b7]")}
            >
              Delivery
            </button>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-[1240px] gap-6 px-5 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <section aria-label="Products" className="min-w-0">
          <div className="mb-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="block text-[12px] font-semibold text-[#655b53]">
              Store location
              <select
                className="field mt-2 min-h-12"
                value={branchId}
                onChange={(event) => chooseBranch(event.target.value)}
              >
                <option value="">Choose a location</option>
                {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>
            {branchId ? <p className="pb-3 font-data text-[10px] text-[#8d8178]">Availability is live for this location</p> : null}
          </div>

          {!branchId ? (
            <div className="rounded-[16px] border border-dashed border-[#d9c9bd] bg-[#fffdfb] px-6 py-14 text-center">
              <p className="font-display text-xl font-semibold">Choose a store location first</p>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#73685f]">Inventory is location-specific. Selecting a branch keeps your cart aligned with what is actually available.</p>
            </div>
          ) : catalogLoading ? (
            <div className="rounded-[16px] border border-[#eee4db] bg-white px-6 py-14 text-center">
              <p role="status" className="font-data text-sm text-[#73685f]">Checking product availability…</p>
            </div>
          ) : catalogError ? (
            <div className="rounded-[16px] border border-[#f0caca] bg-[#fff0f0] px-5 py-4 text-sm text-[#9d3030]" role="alert">{catalogError}</div>
          ) : (catalog?.items.length ?? 0) === 0 ? (
            <div className="rounded-[16px] border border-[#eee4db] bg-white px-6 py-14 text-center">
              <p className="font-display text-xl font-semibold">No products available</p>
              <p className="mt-2 text-sm text-[#73685f]">Try another store location.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[16px] border border-[#eee4db] bg-white shadow-[0_10px_28px_-18px_rgb(28_20_15/0.22)]">
              <div className="flex items-center justify-between gap-4 border-b border-[#eee4db] px-5 py-4">
                <div>
                  <h2 className="font-display text-lg font-semibold">Available products</h2>
                  <p className="mt-1 text-[11px] text-[#8d8178]">{catalog?.total ?? 0} product{catalog?.total === 1 ? "" : "s"} in this location</p>
                </div>
                {(catalog?.total ?? 0) > 100 ? <span className="font-data text-[9px] text-[var(--color-atlas-muted-strong)]">Showing first 100</span> : null}
              </div>
              <ul className="divide-y divide-[#eee6de]">
                {(catalog?.items ?? []).map((item) => {
                  const qty = cart.find((line) => line.productId === item.id)?.qty ?? 0;
                  const unavailable = item.availableToSell !== null && item.availableToSell <= 0;
                  return (
                    <li key={item.id} className="grid gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-[#2a241f]">{item.name}</h3>
                          {item.brand ? <span className="font-data text-[9px] uppercase tracking-[0.08em] text-[var(--color-atlas-muted-strong)]">{item.brand}</span> : null}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#73685f]">
                          <span className="font-data font-semibold text-[#17130f]">{formatOrderMoney(item.priceMinor, storefront.currency)}</span>
                          <span>{item.unit}</span>
                          <span className={unavailable ? "font-semibold text-[#c43e3e]" : "text-[var(--color-atlas-verified)]"}>
                            {item.availableToSell === null ? "Available" : unavailable ? "Out of stock" : item.availableToSell + " available"}
                          </span>
                        </div>
                      </div>
                      {qty > 0 ? (
                        <div className="flex items-center gap-2">
                          <label className="font-data text-[10px] text-[#73685f]" htmlFor={"qty-" + item.id}>Qty</label>
                          <input
                            id={"qty-" + item.id}
                            type="number"
                            min={0}
                            max={item.availableToSell ?? 9999}
                            value={qty}
                            onChange={(event) => setLineQty(item, Number(event.target.value))}
                            className="field !w-20 !py-2 text-center font-data"
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={unavailable}
                          onClick={() => addItem(item)}
                          className="min-h-10 rounded-[9px] bg-[#17130f] px-4 text-[12px] font-semibold text-white transition hover:bg-[#34302c] disabled:cursor-not-allowed disabled:bg-[#d8d0ca] disabled:text-[#73685f]"
                        >
                          Add to order
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        <aside aria-label="Order summary" className="lg:sticky lg:top-5">
          <form onSubmit={submitOrder} noValidate className="overflow-hidden rounded-[16px] border border-[#e5d9cf] bg-white shadow-[0_18px_48px_-24px_rgb(28_20_15/0.28)]">
            <div className="bg-[#252422] px-5 py-5 text-white">
              <p className="font-data text-[9px] uppercase tracking-[0.13em] text-[#ff8061]">Your order</p>
              <div className="mt-3 flex items-end justify-between gap-4">
                <h2 className="font-display text-xl font-semibold">Order slip</h2>
                <span className="font-data text-[11px] text-[#cfc5bd]">{cart.reduce((sum, line) => sum + line.qty, 0)} item{cart.reduce((sum, line) => sum + line.qty, 0) === 1 ? "" : "s"}</span>
              </div>
            </div>

            <div className="px-5 py-5">
              {cartNotice ? <p role="status" className="mb-4 rounded-[10px] bg-[#fff4df] px-3 py-2.5 text-[11px] leading-5 text-[#87540d]">{cartNotice}</p> : null}
              {cartRows.length === 0 ? (
                <p className="rounded-[10px] bg-[#f7f1ea] px-4 py-6 text-center text-sm text-[#73685f]">Your order is empty.</p>
              ) : (
                <ul className="divide-y divide-dashed divide-[#e7ddd5]">
                  {cartRows.map((row) => (
                    <li key={row.productId} className="flex items-start justify-between gap-4 py-3 first:pt-0">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-semibold">{row.item.name}</p>
                        <p className="mt-1 font-data text-[9px] text-[#8d8178]">{row.qty} × {formatOrderMoney(row.item.priceMinor, storefront.currency)}</p>
                      </div>
                      <span className="font-data text-[11px] font-semibold">{formatOrderMoney(row.item.priceMinor * row.qty, storefront.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-4 border-t border-dashed border-[#d9c9bd] pt-4">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-[#73685f]">{serverTotals ? "Server subtotal" : "Estimated merchandise"}</span>
                  <span className="font-data font-semibold">{formatOrderMoney(serverTotals?.subtotalMinor ?? estimatedSubtotalMinor, storefront.currency)}</span>
                </div>
                {fulfillmentMode === "DELIVERY" ? (
                  <div className="mt-2 flex items-center justify-between text-[11px] text-[#73685f]">
                    <span>Delivery fee</span>
                    <span className="font-data">{formatOrderMoney(serverTotals?.deliveryFeeMinor ?? storefront.deliveryFlatFeeMinor, storefront.currency)}</span>
                  </div>
                ) : null}
                {serverTotals ? (
                  <div className="mt-3 flex items-center justify-between border-t border-[#eee4db] pt-3">
                    <span className="text-[12px] font-semibold">Authoritative total</span>
                    <span className="font-data text-[14px] font-bold">{formatOrderMoney(serverTotals.totalMinor, storefront.currency)}</span>
                  </div>
                ) : (
                  <p className="mt-3 text-[10px] leading-4 text-[var(--color-atlas-muted-strong)]">Taxes and final totals are recalculated by the store when you submit.</p>
                )}
              </div>

              <div className="mt-6 space-y-4 border-t border-[#eee4db] pt-5">
                <h3 className="font-display text-[15px] font-semibold">Contact and payment</h3>
                <label className="block text-[11px] font-semibold text-[#655b53]">
                  Name
                  <input className="field mt-2" value={contactName} onChange={(event) => setContactName(event.target.value)} autoComplete="name" />
                </label>
                <label className="block text-[11px] font-semibold text-[#655b53]">
                  Email
                  <input className="field mt-2" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
                </label>
                <label className="block text-[11px] font-semibold text-[#655b53]">
                  Contact number
                  <input className="field mt-2" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" />
                </label>

                {fulfillmentMode === "DELIVERY" ? (
                  <fieldset className="space-y-3">
                    <legend className="text-[11px] font-semibold text-[#655b53]">Delivery address</legend>
                    <input className="field" aria-label="Address line 1" placeholder="Street / building" value={address.line1} onChange={(event) => updateAddress("line1", event.target.value)} autoComplete="address-line1" />
                    <input className="field" aria-label="Address line 2" placeholder="Unit / landmark (optional)" value={address.line2} onChange={(event) => updateAddress("line2", event.target.value)} autoComplete="address-line2" />
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                      <input className="field" aria-label="City" placeholder="City" value={address.city} onChange={(event) => updateAddress("city", event.target.value)} autoComplete="address-level2" />
                      <input className="field" aria-label="Region" placeholder="Province / region" value={address.region} onChange={(event) => updateAddress("region", event.target.value)} autoComplete="address-level1" />
                    </div>
                    <input className="field" aria-label="Postal code" placeholder="Postal code" value={address.postalCode} onChange={(event) => updateAddress("postalCode", event.target.value)} autoComplete="postal-code" />
                  </fieldset>
                ) : null}

                <label className="block text-[11px] font-semibold text-[#655b53]">
                  Fulfillment notes <span className="font-normal text-[var(--color-atlas-muted-strong)]">(optional)</span>
                  <textarea className="field mt-2 min-h-20 resize-y" value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Pickup or delivery instructions" />
                </label>

                {fulfillmentMode === "PICKUP" ? (
                  <fieldset>
                    <legend className="text-[11px] font-semibold text-[#655b53]">Payment timing</legend>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        aria-pressed={paymentMode === "PAY_AT_PICKUP"}
                        onClick={() => { setPaymentMode("PAY_AT_PICKUP"); setPaymentMethod(null); invalidateDraft(); }}
                        className={"min-h-11 rounded-[9px] border px-3 text-[11px] font-semibold " + (paymentMode === "PAY_AT_PICKUP" ? "border-[#f35d3f] bg-[#fff0ea] text-[var(--color-atlas-accent-strong)]" : "border-[#e4d9d0]")}
                      >
                        Pay at pickup
                      </button>
                      <button
                        type="button"
                        aria-pressed={paymentMode === "PREPAID"}
                        onClick={() => { setPaymentMode("PREPAID"); setPaymentMethod((current) => current ?? "card"); invalidateDraft(); }}
                        className={"min-h-11 rounded-[9px] border px-3 text-[11px] font-semibold " + (paymentMode === "PREPAID" ? "border-[#f35d3f] bg-[#fff0ea] text-[var(--color-atlas-accent-strong)]" : "border-[#e4d9d0]")}
                      >
                        Pay online
                      </button>
                    </div>
                  </fieldset>
                ) : null}

                {paymentMode === "PREPAID" ? (
                  <label className="block text-[11px] font-semibold text-[#655b53]">
                    Payment method
                    <select className="field mt-2" value={paymentMethod ?? ""} onChange={(event) => { setPaymentMethod(event.target.value as PublicPaymentMethod); invalidateDraft(); }}>
                      <option value="">Choose payment</option>
                      {PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
                    </select>
                  </label>
                ) : null}

                {submitError ? <p role="alert" className="rounded-[10px] bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium leading-5 text-[#c43e3e]">{submitError}</p> : null}

                <button
                  type="submit"
                  disabled={submitting || !branchId || cart.length === 0 || catalogLoading || catalog === null}
                  aria-busy={submitting}
                  className="min-h-[50px] w-full rounded-[10px] bg-[#f35d3f] px-4 text-[13px] font-semibold text-white shadow-[0_8px_20px_-10px_rgb(243_93_63/0.55)] transition hover:bg-[#d94a30] disabled:cursor-not-allowed disabled:bg-[#d8d0ca] disabled:text-[#73685f] disabled:shadow-none"
                >
                  {submitting ? "Submitting order…" : paymentMode === "PREPAID" ? "Continue to secure payment" : "Submit pickup order"}
                </button>
                <p className="text-center font-data text-[9px] leading-4 text-[var(--color-atlas-muted-strong)]">Final pricing, tax, and availability are verified by the store when you submit.</p>
              </div>
            </div>
          </form>
        </aside>
      </div>
    </main>
  );
}

export default function OrderPage(): JSX.Element {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center bg-[#fcf8f3]"><p role="status">Loading storefront…</p></main>}>
      <OrderExperience />
    </Suspense>
  );
}
