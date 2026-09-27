"use client";

import type { JSX } from "react";

import { useState } from "react";
import { ApiError } from "../../lib/api";
import { cartTotal } from "../../lib/sales";
import { ConnectivityBanner } from "../../lib/sync-ui";
import {
  canPresentPayAction,
  paymentPresentation,
} from "../../lib/pos-view";
import {
  addProductToCart,
  changeCartQuantity,
  filterOfflineCatalog,
  isPayMongoMethodKey,
  resolveTenderedMinor,
  type PosCartEntry,
  type PosProduct,
} from "../../lib/pos-sale-model";
import { completePosSale, holdPosSale, queueOfflinePosSale } from "../../lib/pos-operations";
import { usePosData } from "../../lib/use-pos-data";
import { usePosOffline } from "../../lib/use-pos-offline";
import { AppShell } from "../../components/AppShell";
import { PosCartPanel } from "../../components/PosCartPanel";
import { PosCustomerDialog } from "../../components/PosCustomerDialog";
import { PosPaymentWorkspace } from "../../components/PosPaymentWorkspace";
import { PosProductCatalog } from "../../components/PosProductCatalog";
import { PosResponsiveCart } from "../../components/PosResponsiveCart";

const METHODS: Array<{ key: string; label: string; tile: string }> = [
  { key: "cash", label: "Cash", tile: "bg-[#f35d3f]" },
  { key: "card", label: "Card", tile: "bg-[#776b62]" },
  { key: "gcash", label: "GCash", tile: "bg-[#3468d4]" },
  { key: "maya", label: "Maya", tile: "bg-[#1f8a5b]" },
  { key: "qrph", label: "QR Ph", tile: "bg-[#6554c0]" },
  { key: "bank_transfer", label: "Bank transfer", tile: "bg-[#3468d4]" },
  { key: "other", label: "Other", tile: "bg-[#5d534b]" },
];

export default function PosPage(): JSX.Element {
  const [q, setQ] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState("");
  const [cart, setCart] = useState<PosCartEntry[]>([]);
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

  const {
    meQuery,
    customersQuery,
    registersQuery,
    paymentMethodsQuery,
    categoriesQuery,
    searchQuery,
  } = usePosData(q, activeCategoryId, customerQ);

  const { store, offline, catalogAt, cachedItems, now } = usePosOffline(
    meQuery.data ? { userId: meQuery.data.userId, businessId: meQuery.data.businessId } : undefined,
    meQuery.error,
    meQuery.isLoading,
    searchQuery.data?.items,
  );

  const role = meQuery.data?.role ?? "cashier";
  const canSell = role === "owner" || role === "manager" || role === "cashier";
  const due = cartTotal(cart.map((c) => ({ qty: c.qty, priceMinor: c.priceMinor, lineDiscountMinor: 0 })));
  const effectiveMethod = offline ? "cash" : method;
  const tenderedMinor = resolveTenderedMinor(received, due);
  const changeMinor = Math.max(0, tenderedMinor - due);
  const paymentConfig = paymentMethodsQuery.data?.methods ?? METHODS.map((entry) => ({
    key: entry.key,
    label: entry.label,
    provider: isPayMongoMethodKey(entry.key) ? "paymongo" : "manual",
    available: !isPayMongoMethodKey(entry.key),
  }));
  const configuredMethodKeys = new Set(paymentConfig.map((entry) => entry.key));
  const methodAvailable = (key: string): boolean => paymentConfig.find((entry) => entry.key === key)?.available ?? false;
  const paymentTiles = METHODS.filter((entry) => configuredMethodKeys.has(entry.key));

  function addToCart(p: PosProduct): void {
    setCart((prev) => addProductToCart(prev, p));
  }

  function setQty(productId: string, delta: number): void {
    setCart((prev) => changeCartQuantity(prev, productId, delta));
  }

  async function holdCart(): Promise<void> {
    setStatus("");
    if (offline) {
      setStatus("Holding carts requires connectivity.");
      return;
    }
    try {
      const held = await holdPosSale({
        cart,
        registerId,
        customerId,
        walkIn,
      });
      setCart([]);
      setStatus("Cart held. Resume it from the held sale " + held.draftId + ".");
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
    if (meQuery.isLoading) {
      setStatus("Confirming the signed-in workspace before offline checkout.");
      return;
    }
    if (!store) {
      setStatus("Offline selling is unavailable until this signed-in workspace is identified.");
      return;
    }
    try {
      const queued = await queueOfflinePosSale({
        store,
        cart,
        registerId,
        customerId,
        walkIn,
        received,
        dueMinor: due,
      });
      setCart([]);
      setReceived("");
      setShowPay(false);
      setStatus(
        `Sale queued offline. Provisional receipt ${queued.provisionalReceipt} — pending sync, not yet final. Review it on the sync page.`,
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
    if (isPayMongoMethodKey(method) && !methodAvailable(method)) {
      setStatus("PayMongo is not configured for this payment method yet.");
      return;
    }
    setPaying(true);
    try {
      const result = await completePosSale({
        cart,
        registerId,
        customerId,
        walkIn,
        received,
        method,
      });
      if (result.kind === "redirect") {
        setStatus("Redirecting to PayMongo secure checkout…");
        window.location.assign(result.checkoutUrl);
        return;
      }
      if (result.kind === "unknown") {
        setReconcileId(result.paymentId);
        setReconcileSaleId(result.saleId);
        setShowPay(false);
        setStatus("Payment status unknown. Do not retry blindly — reconcile payment " + (result.paymentId ?? "") + " when the provider responds.");
        return;
      }
      setCart([]);
      setReceived("");
      setShowPay(false);
      setReconcileSaleId(null);
      setReceiptId(result.saleId);
      setStatus("Sale completed.");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.code + ": " + err.message : "Payment failed");
    } finally {
      setPaying(false);
    }
  }

  const items = offline
    ? filterOfflineCatalog(cachedItems, q, activeCategoryId)
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
      <div className="px-3 pb-[124px] text-[#17130f] sm:px-5 lg:pb-5 lg:max-xl:px-10 xl:px-3">
        <main
          className={
            "mx-auto grid max-w-[1212px] overflow-hidden rounded-[20px] bg-[#191816] text-white shadow-[0_14px_34px_-12px_rgb(26_18_13/0.20)] xl:ml-0 xl:mr-auto " +
            "lg:max-xl:h-[1090px] lg:max-xl:min-h-[1090px] xl:min-h-[866px] xl:grid-cols-[760px_452px] xl:gap-0 " +
            (showPay ? "xl:hidden" : "")
          }
        >
        <PosProductCatalog
          registerId={registerId}
          registers={registersQuery.data?.items ?? []}
          query={q}
          activeCategoryId={activeCategoryId}
          categories={categoriesQuery.data?.items ?? []}
          products={items}
          selectedProductIds={new Set(cart.map((item) => item.productId))}
          loading={searchQuery.isLoading}
          offline={offline}
          catalogAt={catalogAt}
          connectivityBanner={offline && store ? <div className="mt-3"><ConnectivityBanner store={store} /></div> : null}
          onRegisterChange={setRegisterId}
          onQueryChange={setQ}
          onSearch={() => void searchQuery.refetch()}
          onCategoryChange={setActiveCategoryId}
          onAddProduct={addToCart}
          onAssignCustomer={() => setShowCustomer(true)}
        />
        <PosCartPanel
          cart={cart}
          count={count}
          due={due}
          selectedRegisterName={selectedRegisterName}
          canSell={canSell}
          canPay={canPay}
          offline={offline}
          effectiveMethod={effectiveMethod}
          status={status}
          statusTone={statusView.tone}
          receiptId={receiptId}
          reconcileId={reconcileId}
          reconcileSaleId={reconcileSaleId}
          methodAvailable={methodAvailable}
          onHold={() => void holdCart()}
          onClearCart={() => setCart([])}
          onResetSale={() => { setCart([]); setStatus(''); setReceiptId(null); }}
          onSetQty={setQty}
          onAssignCustomer={() => setShowCustomer(true)}
          onOpenPayment={() => { setStatus(''); setShowPay(true); }}
          onSelectShortcut={(key) => {
            if (key !== 'more') setMethod(key);
            setStatus('');
            setShowPay(true);
          }}
        />
        </main>

        <PosResponsiveCart
          cart={cart}
          count={count}
          due={due}
          canPay={canPay}
          status={status}
          statusTone={statusView.tone}
          receiptId={receiptId}
          reconcileSaleId={reconcileSaleId}
          drawerOpen={showTabletCart}
          onOpenDrawer={() => setShowTabletCart(true)}
          onCloseDrawer={() => setShowTabletCart(false)}
          onAssignCustomer={() => {
            setShowTabletCart(false);
            setShowCustomer(true);
          }}
          onSetQty={setQty}
          onOpenPayment={() => {
            setShowTabletCart(false);
            setStatus("");
            setShowPay(true);
          }}
        />

        {showCustomer ? (
          <PosCustomerDialog
            customerQuery={customerQ}
            customerId={customerId}
            walkIn={walkIn}
            customers={customersQuery.data?.items ?? []}
            onCustomerQueryChange={(value) => {
              setCustomerQ(value);
              setCustomerId("");
            }}
            onSelectCustomer={(customer) => {
              setCustomerId(customer.id);
              setCustomerQ(customer.name);
              setWalkIn("");
            }}
            onWalkInChange={(value) => {
              setWalkIn(value);
              if (value.trim() !== "") {
                setCustomerId("");
                setCustomerQ("");
              }
            }}
            onClear={() => {
              setCustomerId("");
              setCustomerQ("");
              setWalkIn("");
            }}
            onClose={() => setShowCustomer(false)}
          />
        ) : null}

        {showPay ? (
          <PosPaymentWorkspace
            count={count}
            due={due}
            changeMinor={changeMinor}
            registerSelected={registerId !== ""}
            now={now}
            cart={cart}
            paymentTiles={paymentTiles}
            offline={offline}
            effectiveMethod={effectiveMethod}
            received={received}
            paying={paying}
            canPay={canPay}
            methodAvailable={methodAvailable}
            onMethodChange={setMethod}
            onReceivedChange={setReceived}
            onClose={() => setShowPay(false)}
            onPay={() => void pay()}
          />
        ) : null}
      </div>
    </AppShell>
  );
}
