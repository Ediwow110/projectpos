"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../lib/api";
import { buildProductSearch } from "../../lib/catalog";
import { buildCompletePayload, cartTotal } from "../../lib/sales";
import { watchConnectivity } from "../../lib/connectivity";
import { IndexedDbSyncStore } from "../../lib/sync-store";
import { fingerprintPayload, provisionalReceipt } from "../../lib/sync-state";
import { ConnectivityBanner } from "../../lib/sync-ui";
import {
  canPresentPayAction,
  paymentPresentation,
  productInitials,
  saleFromCompleteResponse,
  type CompleteSaleResponse,
} from "../../lib/pos-view";
import { AppShell } from "../../components/AppShell";

interface Me {
  role: string;
  businessName?: string;
}

interface Csrf {
  csrfToken: string;
}

interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  categoryId: string | null;
  priceMinor: number;
  isActive: boolean;
}

interface CategoryRow {
  id: string;
  name: string;
  isActive: boolean;
}

interface SearchResult {
  items: ProductRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface CartEntry {
  productId: string;
  name: string;
  priceMinor: number;
  qty: number;
}

interface PaymentRow {
  method: string;
  amountMinor: number;
}

interface PaymentMethodConfig {
  key: string;
  label: string;
  available: boolean;
  provider: string;
}

const METHODS: Array<{ key: string; label: string; tile: string }> = [
  { key: "cash", label: "Cash", tile: "bg-[#f35d3f]" },
  { key: "card", label: "Card", tile: "bg-[#776b62]" },
  { key: "gcash", label: "GCash", tile: "bg-[#3468d4]" },
  { key: "maya", label: "Maya", tile: "bg-[#1f8a5b]" },
  { key: "qrph", label: "QR Ph", tile: "bg-[#6554c0]" },
  { key: "bank_transfer", label: "Bank transfer", tile: "bg-[#3468d4]" },
  { key: "other", label: "Other", tile: "bg-[#5d534b]" },
];

function money(minor: number): string {
  return (minor / 100).toFixed(2);
}

function tileColor(name: string): string {
  const palette = ["bg-[#4a2118]", "bg-[#302e2b]", "bg-[#34302c]", "bg-[#3d332d]", "bg-[#292725]", "bg-[#46342e]"];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return palette[h % palette.length];
}

export default function PosPage(): JSX.Element {
  const [q, setQ] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState("");
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [method, setMethod] = useState("cash");
  const [received, setReceived] = useState("");
  const [status, setStatus] = useState("");
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [reconcileId, setReconcileId] = useState<string | null>(null);
  const [reconcileSaleId, setReconcileSaleId] = useState<string | null>(null);
  const [registerId, setRegisterId] = useState("");
  const [customerQ, setCustomerQ] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [walkIn, setWalkIn] = useState("");
  const [showPay, setShowPay] = useState(false);
  const [showCustomer, setShowCustomer] = useState(false);
  const [showTabletCart, setShowTabletCart] = useState(false);
  const [paying, setPaying] = useState(false);
  const [store] = useState(() => new IndexedDbSyncStore());
  const [offline, setOffline] = useState(false);
  const [catalogAt, setCatalogAt] = useState<string | null>(null);
  const [cachedItems, setCachedItems] = useState<ProductRow[]>([]);
  const [now, setNow] = useState("");

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const customersQuery = useQuery({
    queryKey: ["pos-customers", customerQ],
    queryFn: () => apiFetch<{ items: Array<{ id: string; name: string; phone: string | null }> }>(
      "/api/v1/customers?" + new URLSearchParams({ q: customerQ, active: "true", page: "1", pageSize: "10" }).toString(),
    ),
    retry: false,
  });
  const registersQuery = useQuery({
    queryKey: ["pos-registers"],
    queryFn: () => apiFetch<{ items: Array<{ id: string; name: string; isActive: boolean }> }>("/api/v1/registers"),
    retry: false,
  });
  const paymentMethodsQuery = useQuery({
    queryKey: ["payment-methods"],
    queryFn: () => apiFetch<{ methods: PaymentMethodConfig[] }>("/api/v1/payments/methods"),
    retry: false,
  });
  const categoriesQuery = useQuery({
    queryKey: ["pos-categories"],
    queryFn: () => apiFetch<{ items: CategoryRow[] }>("/api/v1/categories"),
    retry: false,
  });
  const searchQuery = useQuery({
    queryKey: ["pos-products", q, activeCategoryId],
    queryFn: () =>
      apiFetch<SearchResult>(
        buildProductSearch({
          q,
          categoryId: activeCategoryId || undefined,
          active: "true",
          page: 1,
          pageSize: 24,
        }),
      ),
    retry: false,
  });

  const role = meQuery.data?.role ?? "cashier";
  const canSell = role === "owner" || role === "manager" || role === "cashier";
  const due = cartTotal(cart.map((c) => ({ qty: c.qty, priceMinor: c.priceMinor, lineDiscountMinor: 0 })));
  const effectiveMethod = offline ? "cash" : method;
  const tenderedMinor = received.trim() === "" ? due : Math.round(Number(received) * 100);
  const changeMinor = Math.max(0, tenderedMinor - due);
  const paymentConfig = paymentMethodsQuery.data?.methods ?? METHODS.map((entry) => ({
    key: entry.key,
    label: entry.label,
    provider: ["card", "gcash", "maya", "qrph"].includes(entry.key) ? "paymongo" : "manual",
    available: !["card", "gcash", "maya", "qrph"].includes(entry.key),
  }));
  const configuredMethodKeys = new Set(paymentConfig.map((entry) => entry.key));
  const methodAvailable = (key: string): boolean => paymentConfig.find((entry) => entry.key === key)?.available ?? false;
  const paymentTiles = METHODS.filter((entry) => configuredMethodKeys.has(entry.key));

  useEffect(() => {
    setNow(new Date().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }));
    const stop = watchConnectivity({
      isOnline: () => navigator.onLine,
      ping: () => apiFetch<{ ok: boolean }>("/api/v1/health").then(() => true).catch(() => false),
      intervalMs: 15000,
      onChange: (s) => setOffline(s === "offline"),
    });
    return stop;
  }, []);

  useEffect(() => {
    if (!searchQuery.data) return;
    const stamp = new Date().toISOString();
    void (async () => {
      for (const p of searchQuery.data!.items) {
        await store.cachePut("catalog", p.id, p, stamp);
      }
      await store.metaSet("lastSyncAt", stamp);
    })();
  }, [searchQuery.data, store]);

  useEffect(() => {
    if (!offline) return;
    void (async () => {
      const cached = await store.cacheList<ProductRow>("catalog");
      setCachedItems(cached.map((c) => c.value));
      setCatalogAt(await store.metaGet("lastSyncAt"));
    })();
  }, [offline, store]);

  function addToCart(p: ProductRow): void {
    setCart((prev) => {
      const found = prev.find((c) => c.productId === p.id);
      if (found) return prev.map((c) => (c.productId === p.id ? { ...c, qty: c.qty + 1 } : c));
      return [...prev, { productId: p.id, name: p.name, priceMinor: p.priceMinor, qty: 1 }];
    });
  }

  function setQty(productId: string, delta: number): void {
    setCart((prev) =>
      prev
        .map((c) => (c.productId === productId ? { ...c, qty: c.qty + delta } : c))
        .filter((c) => c.qty > 0),
    );
  }

  async function holdCart(): Promise<void> {
    setStatus("");
    if (offline) {
      setStatus("Holding carts requires connectivity.");
      return;
    }
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      const draft = await apiFetch<{ id: string }>("/api/v1/sales/drafts", {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          body: JSON.stringify({
            lines: cart.map((c) => ({ productId: c.productId, qty: c.qty })),
            ...(registerId !== "" ? { registerId } : {}),
            ...(customerId !== "" ? { customerId } : {}),
            ...(customerId === "" && walkIn.trim() !== "" ? { customerName: walkIn.trim() } : {}),
          }),
        },
      });
      await apiFetch("/api/v1/sales/" + draft.id + "/hold", {
        csrfToken: csrf.csrfToken,
        init: { method: "POST", body: JSON.stringify({}) },
      });
      setCart([]);
      setStatus("Cart held. Resume it from the held sale " + draft.id + ".");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.code + ": " + err.message : "Hold failed");
    }
  }

  async function payOffline(): Promise<void> {
    setStatus("");
    setReceiptId(null);
    setReconcileId(null);
    setReconcileSaleId(null);
    if (cart.length === 0) {
      setStatus("Cart is empty.");
      return;
    }
    const tendered = received.trim() === "" ? due : Math.round(Number(received) * 100);
    const key = crypto.randomUUID();
    const payload = {
      lines: cart.map((c) => ({ productId: c.productId, qty: c.qty })),
      ...(registerId !== "" ? { registerId } : {}),
      ...(customerId !== "" ? { customerId } : {}),
      ...(customerId === "" && walkIn.trim() !== "" ? { customerName: walkIn.trim() } : {}),
      payments: [{ method: "cash", amountMinor: tendered }],
    };
    try {
      const fingerprint = await fingerprintPayload({ ...payload, key });
      const provisional = provisionalReceipt(key.slice(0, 8));
      await store.enqueue({
        localId: key,
        commandType: "sale.complete",
        key,
        fingerprint,
        payload,
        queuedAt: new Date().toISOString(),
        lastAttemptAt: null,
        provisionalReceipt: provisional,
      });
      setCart([]);
      setReceived("");
      setShowPay(false);
      setStatus(
        `Sale queued offline. Provisional receipt ${provisional} — pending sync, not yet final. Review it on the sync page.`,
      );
    } catch {
      setStatus("Could not queue the offline sale.");
    }
  }

  async function pay(): Promise<void> {
    setStatus("");
    setReceiptId(null);
    setReconcileId(null);
    setReconcileSaleId(null);
    if (cart.length === 0) {
      setStatus("Cart is empty.");
      return;
    }
    if (offline) {
      await payOffline();
      return;
    }
    if (["card", "gcash", "maya", "qrph"].includes(method) && !methodAvailable(method)) {
      setStatus("PayMongo is not configured for this payment method yet.");
      return;
    }
    setPaying(true);
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      const draft = await apiFetch<{ id: string; totalMinor: number }>("/api/v1/sales/drafts", {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          body: JSON.stringify({
            lines: cart.map((c) => ({ productId: c.productId, qty: c.qty })),
            ...(registerId !== "" ? { registerId } : {}),
            ...(customerId !== "" ? { customerId } : {}),
            ...(customerId === "" && walkIn.trim() !== "" ? { customerName: walkIn.trim() } : {}),
          }),
        },
      });
      const total = draft.totalMinor;
      const tendered = received.trim() === "" ? total : Math.round(Number(received) * 100);
      const key = crypto.randomUUID();
      if (["card", "gcash", "maya", "qrph"].includes(method)) {
        const checkout = await apiFetch<{ checkoutUrl: string }>(`/api/v1/sales/${draft.id}/paymongo/checkout`, {
          csrfToken: csrf.csrfToken,
          init: {
            method: "POST",
            body: JSON.stringify({ method }),
            headers: { "Idempotency-Key": key },
          },
        });
        setStatus("Redirecting to PayMongo secure checkout…");
        window.location.assign(checkout.checkoutUrl);
        return;
      }
      const payments: PaymentRow[] =
        method === "cash" && tendered >= total
          ? [{ method, amountMinor: tendered }]
          : [{ method, amountMinor: total }];
      const payload = buildCompletePayload(draft.id, payments, key);
      const response = await apiFetch<CompleteSaleResponse>(
        "/api/v1/sales/complete",
        {
          csrfToken: csrf.csrfToken,
          init: {
            method: "POST",
            body: JSON.stringify(registerId !== "" ? { ...payload, registerId } : payload),
            headers: { "Idempotency-Key": key },
          },
        },
      );
      const done = saleFromCompleteResponse(response);
      if (done.status === "PAYMENT_UNKNOWN") {
        setReconcileId(done.payments[0]?.id ?? null);
        setReconcileSaleId(done.id);
        setShowPay(false);
        setStatus("Payment status unknown. Do not retry blindly — reconcile payment " + (done.payments[0]?.id ?? "") + " when the provider responds.");
        return;
      }
      setCart([]);
      setReceived("");
      setShowPay(false);
      setReconcileSaleId(null);
      setReceiptId(done.id);
      setStatus("Sale completed.");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.code + ": " + err.message : "Payment failed");
    } finally {
      setPaying(false);
    }
  }

  const items = offline
    ? cachedItems.filter(
        (p) =>
          (activeCategoryId === "" || p.categoryId === activeCategoryId) &&
          (
            q.trim() === "" ||
            p.name.toLowerCase().includes(q.trim().toLowerCase()) ||
            (p.sku ?? "").toLowerCase().includes(q.trim().toLowerCase())
          ),
      )
    : (searchQuery.data?.items ?? []);
  const count = cart.reduce((n, c) => n + c.qty, 0);
  const statusView = paymentPresentation(status);
  const canPay = canPresentPayAction(cart.length, canSell) && reconcileId === null;
  const selectedRegisterName =
    registersQuery.data?.items.find((register) => register.id === registerId)?.name ?? "—";

  return (
    <AppShell
      businessName={meQuery.data?.businessName}
      role={role}
      offline={offline}
      posMode
      topbar={
        <label className="inline-flex items-center gap-1 font-data text-[8px] text-[#746960]">
          <span>REG</span>
          <select
            aria-label="Register"
            value={registerId}
            onChange={(e) => setRegisterId(e.target.value)}
            className="max-w-28 bg-transparent font-data text-[8px] font-medium text-[#746960] outline-none"
          >
            <option value="">—</option>
            {(registersQuery.data?.items ?? [])
              .filter((register) => register.isActive)
              .map((register) => (
                <option key={register.id} value={register.id}>{register.name}</option>
              ))}
          </select>
          <span aria-hidden>·</span>
          <span>{now}</span>
          <span className="sr-only">Selected register: {selectedRegisterName}</span>
        </label>
      }
    >
      <div className="px-3 pb-5 text-[#17130f] sm:px-5 lg:max-xl:px-10 xl:px-3">
        <main
          className={
            "mx-auto grid max-w-[1212px] overflow-hidden rounded-[20px] bg-[#191816] text-white shadow-[0_14px_34px_-12px_rgb(26_18_13/0.20)] xl:ml-0 xl:mr-auto " +
            "lg:max-xl:h-[1090px] lg:max-xl:min-h-[1090px] xl:min-h-[866px] xl:grid-cols-[760px_452px] xl:gap-0 " +
            (showPay ? "xl:hidden" : "")
          }
        >
        {/* Products */}
        <section aria-label="Products" className="min-w-0 p-4 lg:max-xl:flex lg:max-xl:h-full lg:max-xl:flex-col lg:max-xl:px-7 lg:max-xl:pb-7 lg:max-xl:pt-6 xl:relative xl:flex xl:h-[866px] xl:flex-col xl:p-[18px] xl:pr-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void searchQuery.refetch();
            }}
            className="flex gap-2.5"
          >
            <div className="relative min-w-0 flex-1">
              <label className="sr-only" htmlFor="pos-search">Search product, SKU or scan barcode</label>
              <input
                id="pos-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
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
              onClick={() => setActiveCategoryId("")}
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
            {(categoriesQuery.data?.items ?? [])
              .filter((category) => category.isActive)
              .map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setActiveCategoryId(category.id)}
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
            {offline && (
              <span className="rounded-full bg-amber-500/15 px-3 py-1.5 text-[11.5px] font-medium text-amber-300">
                Offline catalog{catalogAt ? ` as of ${catalogAt}` : " (never synced)"}
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowCustomer(true)}
              className="ml-auto rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-white/65 hover:text-white lg:hidden"
            >
              Customer
            </button>
          </div>

          {searchQuery.isLoading && <p className="mt-4 text-sm text-white/50">Loading products…</p>}
          {!offline && searchQuery.data?.items.length === 0 && (
            <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-6 text-center text-sm text-white/50">No products found.</p>
          )}
          <ul className="mt-5 grid content-start grid-cols-2 gap-3 sm:grid-cols-3 lg:max-xl:mt-[22px] lg:max-xl:min-h-0 lg:max-xl:flex-1 lg:max-xl:grid-cols-[repeat(3,280px)] lg:max-xl:overflow-y-auto lg:max-xl:pb-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[repeat(4,176px)] xl:gap-2 xl:overflow-y-auto xl:pb-24">
            {items.map((p, i) => (
              <li key={p.id} style={{ animation: `rise 0.35s ${Math.min(i * 0.02, 0.25)}s both` }}>
                <button
                  onClick={() => addToCart(p)}
                  className={
                    "card-hover relative w-full rounded-xl border bg-[#252422] p-3 text-left lg:max-xl:h-[220px] lg:max-xl:p-[13px] xl:h-[152px] xl:p-[11px] " +
                    (cart.some((item) => item.productId === p.id) ? "border-[#ff765a]" : "border-[#35312d]")
                  }
                >
                  <span
                    data-ui="product-visual"
                    className={
                      "font-display flex h-16 items-center rounded-[9px] px-[14px] text-2xl font-extrabold text-white/95 lg:max-xl:absolute lg:max-xl:left-[13px] lg:max-xl:top-[13px] lg:max-xl:h-[100px] lg:max-xl:w-[252px] lg:max-xl:px-4 xl:absolute xl:left-[11px] xl:top-[11px] xl:h-[62px] xl:w-[152px] xl:text-[20px] " +
                      (cart.some((item) => item.productId === p.id) ? "bg-[#4a2118]" : tileColor(p.name))
                    }
                    aria-hidden
                  >
                    {productInitials(p.name)}
                  </span>
                  <span className="mt-2.5 block truncate text-[13.5px] font-semibold lg:max-xl:absolute lg:max-xl:left-[13px] lg:max-xl:top-[131px] lg:max-xl:mt-0 lg:max-xl:max-w-[252px] lg:max-xl:text-[12px] xl:absolute xl:left-[11px] xl:top-[83px] xl:mt-0 xl:max-w-[120px] xl:text-[10px]">{p.name}</span>
                  <span className="money absolute bottom-3 left-3 block text-[13px] font-bold text-white/85 lg:max-xl:left-[13px] lg:max-xl:top-[185px] lg:max-xl:bottom-auto lg:max-xl:text-[11px] xl:left-[11px] xl:top-[125px] xl:bottom-auto xl:text-[10px]">₱{money(p.priceMinor)}</span>
                  <span data-ui="product-add" aria-hidden className="absolute hidden h-7 w-7 place-items-center rounded-lg bg-[#f35d3f] text-[18px] font-semibold text-[#211814] xl:left-[135px] xl:top-[113px] xl:grid">+</span>
                </button>
              </li>
            ))}
          </ul>

          <div className="hidden xl:absolute xl:bottom-[18px] xl:left-[18px] xl:right-[18px] xl:flex xl:items-center xl:gap-2 xl:rounded-xl xl:border xl:border-white/10 xl:bg-[#252422] xl:p-3">
            <span className="mr-auto text-[11px] font-semibold text-white/70">⚡ Quick actions</span>
            <button
              type="button"
              onClick={() => setShowCustomer(true)}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-5 py-2 text-[10px] font-semibold text-white/75 hover:bg-white/[0.08] hover:text-white"
            >
              Add customer <span className="font-data text-white/35">F1</span>
            </button>
          </div>
          {offline ? <div className="mt-3"><ConnectivityBanner store={store} /></div> : null}
        </section>

        {/* Cart panel */}
        <aside id="pos-cart" aria-label="Cart" className="lg:max-xl:hidden xl:h-full xl:bg-[#171614] xl:p-5">
          <div className="relative h-full overflow-hidden bg-[#171614]">
            <h2 aria-label={`Cart (${count})`} className="absolute left-0 top-0 font-display text-[18px] font-semibold">Current sale</h2>
            <button
              type="button"
              onClick={() => void holdCart()}
              disabled={cart.length === 0}
              className="absolute right-[60px] top-[-4px] h-[34px] w-[90px] rounded-[9px] border border-[#3b3732] bg-[#252422] text-[9px] font-semibold text-[#d5cdc6] disabled:opacity-40"
            >
              Hold
            </button>
            <button
              type="button"
              aria-label="Clear sale"
              onClick={() => setCart([])}
              disabled={cart.length === 0}
              className="absolute right-[10px] top-[-4px] h-[34px] w-[42px] rounded-[9px] border border-[#3b3732] bg-[#252422] text-[14px] font-semibold text-[#ff765a] disabled:opacity-40"
            >
              ⌫
            </button>
            <div aria-hidden className="absolute inset-x-0 top-[46px] border-t border-[#393530]" />

            {!canSell ? (
              <p role="alert" className="absolute inset-x-0 top-[56px] z-10 rounded-lg bg-red-500/15 px-3 py-2 text-[11px] font-medium text-red-300">
                Your role cannot complete sales.
              </p>
            ) : null}

            <ul className="absolute inset-x-0 top-[56px] overflow-y-auto xl:h-[244px]">
              {cart.length === 0 ? (
                <li className="grid h-full place-items-center text-[11px] text-white/40">Cart is empty. Tap products to add.</li>
              ) : null}
              {cart.map((c) => (
                <li key={c.productId} className="flex h-[61px] items-center justify-between gap-3 border-b border-[#393530]">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[9px] font-semibold text-white">{c.name}</p>
                    <div className="mt-2 flex items-center gap-2 font-data text-[8px] text-[#aaa096]">
                      <span>Qty {c.qty}</span>
                      <button type="button" onClick={() => setQty(c.productId, -1)} aria-label={"Decrease " + c.name} className="grid h-5 w-5 place-items-center rounded bg-white/[0.06] text-[11px] hover:bg-white/10">−</button>
                      <button type="button" onClick={() => setQty(c.productId, 1)} aria-label={"Increase " + c.name} className="grid h-5 w-5 place-items-center rounded bg-white/[0.06] text-[11px] hover:bg-white/10">+</button>
                    </div>
                  </div>
                  <span className="money shrink-0 text-[9px] font-medium text-white">₱{money(c.qty * c.priceMinor)}</span>
                </li>
              ))}
            </ul>

            <button
              type="button"
              aria-label="Assign customer to sale"
              onClick={() => setShowCustomer(true)}
              className="absolute inset-x-0 top-[322px] h-[38px] rounded-[8px] bg-[#252422] px-3 text-left text-[9px] text-[#aaa096] hover:text-white"
            >
              ○ Add customer / walk-in
            </button>

            <div className="absolute inset-x-0 top-[382px] flex items-center justify-between text-[9px] text-[#afa59d]">
              <span>Subtotal ({count} item{count === 1 ? "" : "s"})</span>
              <span className="money font-medium text-white">₱{money(due)}</span>
            </div>
            <div className="absolute inset-x-0 top-[414px] flex items-center justify-between text-[9px] text-[#afa59d]">
              <span>Register</span>
              <span className="font-data max-w-48 truncate text-[8px] text-white/75">{selectedRegisterName}</span>
            </div>
            <div aria-hidden className="absolute inset-x-0 top-[452px] border-t border-[#393530]" />
            <div className="absolute inset-x-0 top-[467px] flex items-end justify-between">
              <span className="font-display text-[16px] font-semibold">Total</span>
              <span className="money text-[24px] font-bold">₱{money(due)}</span>
            </div>

            <button
              type="button"
              onClick={() => { setStatus(""); setShowPay(true); }}
              disabled={!canPay}
              className="absolute inset-x-0 top-[520px] h-[58px] rounded-xl bg-[#f35d3f] font-display text-[13px] font-semibold text-white shadow-[0_5px_16px_-6px_rgb(26_18_13/0.07)] hover:bg-[#d94a30] disabled:opacity-40"
            >
              ▣ Pay ₱{money(due)} (F5) →
            </button>

            <div className="absolute inset-x-0 top-[596px] grid grid-cols-4 gap-2">
              {[
                { key: "cash", label: "Cash (F6)" },
                { key: "card", label: "Card (F7)" },
                { key: "gcash", label: "GCash (F8)" },
                { key: "more", label: "More" },
              ].map((shortcut) => (
                <button
                  key={shortcut.key}
                  type="button"
                  onClick={() => {
                    if (shortcut.key !== "more") setMethod(shortcut.key);
                    setStatus("");
                    setShowPay(true);
                  }}
                  disabled={
                    !canPay ||
                    (offline && shortcut.key !== "cash") ||
                    (shortcut.key !== "more" && !methodAvailable(shortcut.key))
                  }
                  className={
                    "h-[42px] rounded-[10px] border text-[8px] font-semibold transition disabled:opacity-35 " +
                    (shortcut.key === effectiveMethod
                      ? "border-[#ff765a] bg-[#302522] text-[#ffb7a4]"
                      : "border-[#3b3732] bg-[#252422] text-[#d5cdc6] hover:border-[#5a524b]")
                  }
                >
                  {shortcut.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                setCart([]);
                setStatus("");
                setReceiptId(null);
              }}
              disabled={cart.length === 0 || reconcileId !== null}
              className="absolute inset-x-0 top-[660px] h-12 rounded-[10px] border border-[#d94a30] text-[10px] font-semibold text-[#ff765a] hover:bg-[#2b1d19] disabled:opacity-35"
            >
              ⌫ Clear sale
            </button>
            <p className="absolute inset-x-0 top-[728px] font-data text-[7px] leading-4 text-[#756b63]">
              Totals are server-validated before commit. Unknown payment status blocks blind retries.
            </p>

            {status.includes("SHIFT_NO_OPEN_SHIFT") ? (
              <div className="absolute inset-x-0 top-[322px] z-20 rounded-xl bg-[#302717] px-3 py-3 text-[10px] text-amber-300 shadow-xl">
                <p role="alert">No open shift on this register. <Link href="/shifts" className="font-semibold underline">Open a shift</Link> first.</p>
              </div>
            ) : null}
            {status !== "" && !status.includes("SHIFT_NO_OPEN_SHIFT") ? (
              <div className={`absolute inset-x-0 top-[322px] z-20 max-h-[170px] overflow-auto rounded-xl px-3 py-3 text-[10px] font-medium shadow-xl ${statusView.tone === "ok" ? "bg-[#173329] text-[#9de0c3]" : statusView.tone === "warn" ? "bg-[#302717] text-[#ffd58a]" : statusView.tone === "info" ? "bg-[#18243b] text-[#bfd0ff]" : "bg-[#211f1d] text-white/75"}`}>
                <p role={status.includes("unknown") ? "alert" : "status"}>{status}</p>
                {reconcileSaleId ? (
                  <Link href={"/sales/" + reconcileSaleId} className="mt-2 inline-flex font-semibold underline">
                    Review unknown payment →
                  </Link>
                ) : null}
              </div>
            ) : null}
            {receiptId ? (
              <Link href={"/receipts/" + receiptId} className="absolute inset-x-0 top-[322px] z-30 rounded-xl border border-green-500/40 bg-[#173329] px-4 py-3 text-center text-[11px] font-bold text-green-300 shadow-xl">
                View receipt →
              </Link>
            ) : null}
          </div>
        </aside>
        </main>

        <div
          role="region"
          aria-label="Tablet cart"
          className="fixed inset-x-0 bottom-0 z-30 hidden h-[160px] bg-[#171614] text-white shadow-[0_18px_48px_-18px_rgb(0_0_0/0.55)] lg:max-xl:block"
        >
          <div className="absolute left-7 top-6 max-w-[520px]">
            <p className="text-[12px] font-semibold">{count} item{count === 1 ? "" : "s"} in cart</p>
            <p className="mt-1 truncate text-[10px] text-white/45">
              {cart.length === 0 ? "Tap a product to begin a sale." : cart.slice(0, 3).map((item) => item.name + " ×" + item.qty).join(" · ")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowTabletCart(true)}
            className="absolute left-7 top-[88px] h-12 w-[180px] rounded-[10px] border border-white/15 text-[11px] font-semibold text-white/80"
          >
            View cart
          </button>
          <div className="absolute right-[221px] top-6 w-[123px] text-left">
            <p className="font-data text-[8px] uppercase tracking-[0.12em] text-white/45">Total</p>
            <p className="font-display mt-1 text-xl font-bold">₱{money(due)}</p>
          </div>
          <button
            type="button"
            aria-label="Pay"
            onClick={() => {
              setStatus("");
              setShowPay(true);
            }}
            disabled={!canPay}
            className="absolute right-7 top-20 h-14 w-[290px] rounded-[10px] bg-[#f35d3f] font-display text-[12px] font-semibold text-white shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] hover:bg-[#d94a30] disabled:opacity-40"
          >
            PAY ₱{money(due)}
          </button>
        </div>

        {status !== "" ? (
          <div role="region" aria-label="Tablet payment status" className="fixed inset-x-7 bottom-[172px] z-30 hidden lg:max-xl:block">
            <div
              className={
                "rounded-xl border px-4 py-3 text-[12px] font-medium shadow-[0_14px_34px_-14px_rgb(0_0_0/0.55)] " +
                (statusView.tone === "ok"
                  ? "border-[#2f6954] bg-[#173329] text-[#9de0c3]"
                  : statusView.tone === "warn"
                    ? "border-[#755b28] bg-[#302717] text-[#ffd58a]"
                    : statusView.tone === "info"
                      ? "border-[#395d9c] bg-[#18243b] text-[#bfd0ff]"
                      : "border-white/10 bg-[#211f1d] text-white/75")
              }
            >
              <p role={status.includes("unknown") ? "alert" : "status"}>{status}</p>
              {reconcileSaleId ? (
                <Link href={"/sales/" + reconcileSaleId} className="mt-2 inline-flex font-semibold underline">
                  Review unknown payment →
                </Link>
              ) : null}
              {receiptId ? (
                <Link href={"/receipts/" + receiptId} className="mt-2 inline-flex font-semibold underline">
                  View receipt →
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}

        {showTabletCart ? (
          <div
            className="fixed inset-0 z-40 hidden bg-black/45 p-5 lg:max-xl:block"
            role="dialog"
            aria-modal="true"
            aria-label="Tablet cart details"
          >
            <div className="ml-auto flex h-full w-full max-w-[420px] flex-col overflow-hidden rounded-[18px] border border-white/10 bg-[#171614] text-white shadow-[0_24px_60px_-18px_rgb(0_0_0/0.62)]">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div>
                  <p className="font-display text-base font-semibold">Current sale</p>
                  <p className="mt-1 text-[10px] text-white/45">{count} item{count === 1 ? "" : "s"} in cart</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { setShowTabletCart(false); setShowCustomer(true); }}
                    className="rounded-lg border border-white/10 px-3 py-2 text-[10px] font-semibold text-white/70 hover:text-white"
                  >
                    Add customer
                  </button>
                  <button
                    type="button"
                    aria-label="Close cart"
                    onClick={() => setShowTabletCart(false)}
                    className="grid h-9 w-9 place-items-center rounded-lg bg-white/[0.07] text-white/65 hover:text-white"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <ul className="min-h-0 flex-1 space-y-2 overflow-auto px-5 py-4">
                {cart.length === 0 ? (
                  <li className="rounded-xl bg-white/[0.04] p-6 text-center text-sm text-white/45">
                    Cart is empty. Tap products to add.
                  </li>
                ) : null}
                {cart.map((c) => (
                  <li key={c.productId} className="flex items-center gap-3 rounded-xl bg-white/[0.05] p-3">
                    <span className={"grid h-10 w-10 shrink-0 place-items-center rounded-lg " + tileColor(c.name) + " text-sm font-extrabold"} aria-hidden>
                      {productInitials(c.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold">{c.name}</p>
                      <p className="money mt-1 text-[11px] text-white/45">₱{money(c.priceMinor)} each</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setQty(c.productId, -1)}
                        aria-label={"Decrease " + c.name}
                        className="grid h-7 w-7 place-items-center rounded-md bg-white/10 text-sm font-bold"
                      >
                        −
                      </button>
                      <span className="money w-6 text-center text-[13px] font-bold">{c.qty}</span>
                      <button
                        type="button"
                        onClick={() => setQty(c.productId, 1)}
                        aria-label={"Increase " + c.name}
                        className="grid h-7 w-7 place-items-center rounded-md bg-white/10 text-sm font-bold hover:bg-[#f35d3f]"
                      >
                        +
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="border-t border-white/10 p-5">
                <div className="flex items-end justify-between">
                  <div>
                    <p className="font-data text-[8px] uppercase tracking-[0.12em] text-white/45">Total</p>
                    <p className="font-display mt-1 text-2xl font-bold">₱{money(due)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowTabletCart(false);
                      setStatus("");
                      setShowPay(true);
                    }}
                    disabled={!canPay}
                    className="min-h-12 rounded-[10px] bg-[#f35d3f] px-7 font-display text-[12px] font-semibold text-white shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] hover:bg-[#d94a30] disabled:opacity-40"
                  >
                    Pay ₱{money(due)}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {showCustomer ? (
          <div className="fixed inset-0 z-[70] grid place-items-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-label="Customer assignment">
            <div className="w-full max-w-lg rounded-[18px] border border-white/10 bg-[#171614] p-5 text-white shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-data text-[8px] uppercase tracking-[0.14em] text-[#ff765a]">Current sale</p>
                  <h2 className="font-display mt-2 text-xl font-semibold">Assign customer</h2>
                  <p className="mt-1 text-[11px] text-white/45">Choose an existing customer or keep a walk-in name for this sale.</p>
                </div>
                <button
                  type="button"
                  aria-label="Close customer assignment"
                  onClick={() => setShowCustomer(false)}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.07] text-white/60 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="relative block text-[10px] font-semibold uppercase tracking-[0.08em] text-white/45">
                  Customer
                  <input
                    value={customerQ}
                    onChange={(e) => {
                      setCustomerQ(e.target.value);
                      setCustomerId("");
                    }}
                    placeholder="Search customers"
                    className="field-dark mt-2 normal-case tracking-normal"
                  />
                  {customerQ.trim() !== "" ? (
                    <ul className="absolute z-20 mt-1 max-h-44 w-full overflow-auto rounded-xl border border-white/10 bg-[#252422] p-1 shadow-xl">
                      {(customersQuery.data?.items ?? []).map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => { setCustomerId(c.id); setCustomerQ(c.name); setWalkIn(""); }}
                            className="w-full rounded-lg px-3 py-2 text-left text-[12px] normal-case hover:bg-white/10"
                          >
                            <span className="font-semibold">{c.name}</span>
                            {c.phone ? <span className="text-white/45"> — {c.phone}</span> : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </label>

                <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-white/45">
                  Walk-in name
                  <input
                    value={walkIn}
                    onChange={(e) => {
                      setWalkIn(e.target.value);
                      if (e.target.value.trim() !== "") {
                        setCustomerId("");
                        setCustomerQ("");
                      }
                    }}
                    placeholder="Optional"
                    className="field-dark mt-2 normal-case tracking-normal"
                  />
                </label>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                <p className="text-[11px] text-white/45">
                  {customerId !== "" ? `Selected: ${customerQ}` : walkIn.trim() !== "" ? `Walk-in: ${walkIn.trim()}` : "No customer assigned"}
                </p>
                <div className="flex gap-2">
                  {(customerId !== "" || walkIn.trim() !== "") ? (
                    <button
                      type="button"
                      onClick={() => { setCustomerId(""); setCustomerQ(""); setWalkIn(""); }}
                      className="rounded-lg border border-white/10 px-3 py-2 text-[11px] font-semibold text-white/60 hover:text-white"
                    >
                      Clear
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setShowCustomer(false)}
                    className="rounded-lg bg-[#f35d3f] px-5 py-2 text-[11px] font-semibold text-white hover:bg-[#d94a30]"
                  >
                    Use for sale
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {showPay ? (
          <>
            <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 xl:hidden" role="dialog" aria-modal="true" aria-label="Payment">
              <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-[#171614] shadow-2xl animate-[rise_0.3s_ease_both]">
                <div className="flex items-center justify-between px-5 pt-4">
                  <div>
                    <h2 className="text-[15px] font-bold">Payment</h2>
                    <p className="text-[11.5px] text-white/40">Current sale · {count} item{count === 1 ? "" : "s"}</p>
                  </div>
                  <button onClick={() => setShowPay(false)} aria-label="Close payment" className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.07] text-white/60 hover:text-white">✕</button>
                </div>
                <p className="money mt-2 text-center text-[30px] font-extrabold">₱{money(due)}</p>
                <p className="text-center text-[11.5px] text-white/40">Total Amount</p>
                <div className="grid grid-cols-3 gap-2 px-5 pt-3">
                  {paymentTiles.filter((m) => !offline || m.key === "cash").map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setMethod(m.key)}
                      disabled={!methodAvailable(m.key)}
                      title={!methodAvailable(m.key) && ["card", "gcash", "maya", "qrph"].includes(m.key) ? "Configure PayMongo to enable this method" : undefined}
                      className={`rounded-xl px-1 py-2.5 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-30 ${effectiveMethod === m.key ? m.tile + " text-white ring-2 ring-white/60" : "bg-white/[0.06] text-white/60 hover:bg-white/10"}`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {offline && <p className="px-5 pt-2 text-[11.5px] text-amber-300">Offline sales accept cash only.</p>}
                <div className="grid grid-cols-2 gap-2 px-5 pt-3">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-white/40">
                    Amount Received
                    <input
                      value={received}
                      onChange={(e) => setReceived(e.target.value)}
                      placeholder={money(due)}
                      inputMode="decimal"
                      className="field-dark money mt-1.5"
                    />
                  </label>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
                    Change
                    <p className="money mt-1.5 rounded-[10px] border border-green-500/30 bg-green-500/10 px-3 py-[9px] text-[15px] font-bold text-green-300">₱{money(changeMinor)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 p-5">
                  <button onClick={() => setShowPay(false)} className="rounded-xl border border-white/15 py-2.5 text-sm font-semibold text-white/70 hover:text-white">Cancel</button>
                  <button onClick={() => void pay()} disabled={paying || !canPay} className="rounded-xl bg-[#f35d3f] py-2.5 text-sm font-bold shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] hover:bg-[#d94a30] disabled:opacity-50">
                    {paying ? "Processing…" : "Complete Payment"}
                  </button>
                </div>
              </div>
            </div>

            <section
              data-ui="payment-workspace"
              role="dialog"
              aria-label="Payment"
              className="mx-auto hidden h-[866px] max-w-[1212px] overflow-hidden rounded-[20px] bg-[#191816] text-white shadow-[0_14px_34px_-12px_rgb(26_18_13/0.20)] xl:ml-0 xl:mr-auto xl:grid xl:grid-cols-[650px_562px]"
            >
              <div className="px-[46px] pt-14">
                <p className="font-data text-[9px] font-medium uppercase tracking-[0.05em] text-[#ff765a]">
                  PAYMENT / {registerId ? "REGISTER SELECTED" : "NO REGISTER"}
                </p>
                <h2 className="font-display mt-5 text-[34px] font-bold">Take payment</h2>
                <p className="font-data mt-4 text-[9px] font-medium uppercase tracking-[0.05em] text-[#9e948c]">Amount due</p>
                <p className="money mt-1 text-[50px] font-bold leading-none">₱{money(due)}</p>

                <div className="mt-[42px] grid w-[556px] grid-cols-3 gap-3.5">
                  {paymentTiles.filter((m) => !offline || m.key === "cash").map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setMethod(m.key)}
                      disabled={!methodAvailable(m.key)}
                      title={!methodAvailable(m.key) && ["card", "gcash", "maya", "qrph"].includes(m.key) ? "Configure PayMongo to enable this method" : undefined}
                      className={
                        "h-[52px] rounded-[10px] border text-[10px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-30 " +
                        (effectiveMethod === m.key
                          ? "border-[#f35d3f] bg-[#f35d3f] text-white"
                          : "border-[#3b3732] bg-[#252422] text-[#d5cdc6] hover:border-[#5a524b]")
                      }
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {offline ? <p className="mt-3 text-[11px] font-medium text-amber-300">Offline sales accept cash only.</p> : null}

                <label className="mt-[46px] block w-[556px] text-[10px] font-semibold text-[#b7ada5]">
                  Cash received
                  <input
                    value={received}
                    onChange={(e) => setReceived(e.target.value)}
                    placeholder={money(due)}
                    inputMode="decimal"
                    className="field-dark money mt-[11px] !h-[66px] !rounded-[10px] !px-4 !text-[25px] !font-semibold"
                  />
                </label>

                <div className="mt-6 h-[92px] w-[556px] rounded-xl bg-[#fff0ea] px-4 py-4 text-[#17130f]">
                  <p className="font-data text-[9px] font-medium uppercase text-[#e44e34]">Change</p>
                  <p className="money mt-2 text-[28px] font-bold">₱{money(changeMinor)}</p>
                </div>

                <button
                  type="button"
                  onClick={() => void pay()}
                  disabled={paying || !canPay}
                  className="mt-[30px] h-16 w-[556px] rounded-xl bg-[#f35d3f] font-display text-[13px] font-semibold text-white shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] hover:bg-[#d94a30] disabled:opacity-50"
                >
                  {paying ? "Processing…" : "Complete payment   ENTER"}
                </button>
              </div>

              <div className="bg-white px-9 pt-14 text-[#17130f]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-display text-[20px] font-semibold">Sale summary</h3>
                    <p className="font-data mt-3 text-[8px] uppercase tracking-[0.04em] text-[#8b8077]">
                      DRAFT · {registerId ? "REGISTER" : "NO REGISTER"} · {now || "CURRENT"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPay(false)}
                    className="rounded-lg border border-[#eee4db] px-3 py-2 text-[9px] font-semibold text-[#73685f] hover:text-[#d94a30]"
                  >
                    Back to sale
                  </button>
                </div>

                <ul className="mt-10 space-y-6">
                  {cart.map((item) => (
                    <li key={item.productId} className="flex items-center justify-between gap-4 text-[10px] font-semibold text-[#2a241f]">
                      <span className="min-w-0 truncate">{item.qty} × {item.name}</span>
                      <span className="money shrink-0 text-[9px]">₱{money(item.qty * item.priceMinor)}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-12 border-t border-[#eee4db] pt-10">
                  <div className="rounded-xl bg-[#edf3ff] p-4 text-[#2b4f94]">
                    <p className="text-[11px] font-semibold">If payment status becomes uncertain</p>
                    <p className="mt-4 text-[10px] leading-5 text-[#394967]">
                      Keep the sale in context and reconcile the provider result. NexPOS will not present an unknown payment as successful or ask you to retry blindly.
                    </p>
                  </div>
                  <div className="mt-6 rounded-xl bg-[#fcf8f3] px-4 py-4">
                    <p className="font-data text-[8px] uppercase tracking-[0.06em] text-[#8b8077]">Current total</p>
                    <div className="mt-2 flex items-end justify-between">
                      <span className="text-[11px] font-semibold text-[#51483f]">{count} item{count === 1 ? "" : "s"}</span>
                      <span className="money text-[22px] font-bold text-[#17130f]">₱{money(due)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
