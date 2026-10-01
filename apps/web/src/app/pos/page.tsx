"use client";

import type { JSX } from "react";

import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import { cartTotal } from "../../lib/sales";
import { ConnectivityBanner } from "../../lib/sync-ui";
import {
  canPresentPayAction,
  paymentPresentation,
  posSaleErrorMessage,
} from "../../lib/pos-view";
import {
  addProductToCart,
  applyCartDiscounts,
  changeCartQuantity,
  filterOfflineCatalog,
  heldSaleToCart,
  isPayMongoMethodKey,
  posDiscountSummary,
  resolveTenderedMinor,
  type PosCartEntry,
  type PosHeldSale,
  type PosProduct,
} from "../../lib/pos-sale-model";
import { completePosSale, holdPosSale, queueOfflinePosSale, resumePosSale } from "../../lib/pos-operations";
import { usePosData } from "../../lib/use-pos-data";
import { usePosOffline } from "../../lib/use-pos-offline";
import { registersForBranch } from "../../lib/workspace-branch";
import { AppShell } from "../../components/AppShell";
import { PosCartPanel } from "../../components/PosCartPanel";
import { PosCustomerDialog } from "../../components/PosCustomerDialog";
import { PosDiscountDialog } from "../../components/PosDiscountDialog";
import { PosHeldSalesDialog } from "../../components/PosHeldSalesDialog";
import { ManagerApprovalDialog } from "../../components/ManagerApprovalDialog";
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
  const [orderDiscountMinor, setOrderDiscountMinor] = useState(0);
  const [showPay, setShowPay] = useState(false);
  const [showCustomer, setShowCustomer] = useState(false);
  const [showDiscounts, setShowDiscounts] = useState(false);
  const [showHeldSales, setShowHeldSales] = useState(false);
  const [showTabletCart, setShowTabletCart] = useState(false);
  const [approvalRequest, setApprovalRequest] = useState<"pay" | "hold" | null>(null);
  // ManagerApprovalDialog calls onClose() after a successful approval as well as
  // after a cancellation. Without this flag the cancel message would overwrite
  // the real "Sale completed."/"Sale held." status the sale just produced.
  const discountApprovedRef = useRef(false);
  const [paying, setPaying] = useState(false);
  const [resumingSaleId, setResumingSaleId] = useState<string | null>(null);
  const [activeDraft, setActiveDraft] = useState<{ id: string; totalMinor: number } | null>(null);

  const {
    meQuery,
    customersQuery,
    registersQuery,
    paymentMethodsQuery,
    categoriesQuery,
    searchQuery,
    heldSalesQuery,
  } = usePosData(q, activeCategoryId, customerQ);

  const { store, offline, catalogAt, cachedItems, now } = usePosOffline(
    meQuery.data ? { userId: meQuery.data.userId, businessId: meQuery.data.businessId } : undefined,
    meQuery.error,
    meQuery.isLoading,
    searchQuery.data?.items,
  );

  const role = meQuery.data?.role ?? "cashier";
  const scopedRegisters = registersForBranch(
    registersQuery.data?.items ?? [],
    meQuery.data?.activeBranchId,
  );
  useEffect(() => {
    if (registerId !== "" && !scopedRegisters.some((register) => register.id === registerId)) {
      setRegisterId("");
    }
  }, [registerId, scopedRegisters]);
  const canSell = role === "owner" || role === "manager" || role === "cashier";
  const discountSummary = posDiscountSummary(cart, orderDiscountMinor);
  const cartDue = cartTotal(cart.map((c) => ({ qty: c.qty, priceMinor: c.priceMinor, lineDiscountMinor: c.lineDiscountMinor }))) - discountSummary.orderDiscountMinor;
  const due = activeDraft?.totalMinor ?? Math.max(0, cartDue);
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

  const resumedSaleLocked = activeDraft !== null;

  function lockedSaleMessage(): void {
    setStatus("This resumed sale is locked to its saved cart. Pay it or Hold it again before making changes.");
  }

  function addToCart(p: PosProduct): void {
    if (resumedSaleLocked) {
      lockedSaleMessage();
      return;
    }
    setCart((prev) => addProductToCart(prev, p));
  }

  function setQty(productId: string, delta: number): void {
    if (resumedSaleLocked) {
      lockedSaleMessage();
      return;
    }
    setCart((prev) => {
      const next = changeCartQuantity(prev, productId, delta);
      setOrderDiscountMinor((current) => posDiscountSummary(next, current).orderDiscountMinor);
      return next;
    });
  }

  function setSaleRegister(nextRegisterId: string): void {
    if (resumedSaleLocked) {
      lockedSaleMessage();
      return;
    }
    setRegisterId(nextRegisterId);
  }

  function openCustomerAssignment(): void {
    if (resumedSaleLocked) {
      lockedSaleMessage();
      return;
    }
    setShowCustomer(true);
  }

  function openDiscounts(): void {
    if (offline) {
      setStatus("Reconnect before applying discounts.");
      return;
    }
    if (resumedSaleLocked) {
      lockedSaleMessage();
      return;
    }
    if (cart.length === 0) {
      setStatus("Add an item before applying discounts.");
      return;
    }
    setStatus("");
    setShowDiscounts(true);
  }

  function openHeldSales(): void {
    if (offline) {
      setStatus("Held sales require connectivity.");
      return;
    }
    void heldSalesQuery.refetch();
    setShowHeldSales(true);
  }

  async function resumeHeldSale(held: PosHeldSale): Promise<void> {
    setStatus("");
    if (offline) {
      setStatus("Reconnect before resuming a held sale.");
      return;
    }
    if (cart.length > 0) {
      setShowHeldSales(false);
      setStatus("Hold or clear the current sale before resuming another held sale.");
      return;
    }
    const activeBranchId = meQuery.data?.activeBranchId ?? null;
    if (activeBranchId !== null && held.sale.branchId !== activeBranchId) {
      setShowHeldSales(false);
      setStatus("Switch to the held sale's branch before resuming it.");
      return;
    }
    setResumingSaleId(held.sale.id);
    try {
      await resumePosSale(held.sale.id);
      setCart(heldSaleToCart(held.sale));
      setActiveDraft({ id: held.sale.id, totalMinor: held.sale.totalMinor });
      setOrderDiscountMinor(held.sale.discountMinor);
      setRegisterId(held.sale.registerId ?? "");
      setCustomerId(held.sale.customerId ?? "");
      if (held.sale.customerId) {
        setCustomerQ(held.sale.customerName ?? "");
        setWalkIn("");
      } else {
        setCustomerQ("");
        setWalkIn(held.sale.customerName ?? "");
      }
      setShowHeldSales(false);
      await heldSalesQuery.refetch();
      setStatus("Held sale resumed. Its saved cart is locked until payment or re-hold.");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.code + ": " + err.message : "Resume failed");
    } finally {
      setResumingSaleId(null);
    }
  }

  function requireManagerApproval(action: "pay" | "hold", retrying: boolean): void {
    discountApprovedRef.current = false;
    setApprovalRequest(action);
    if (retrying) setStatus("That approval expired or no longer matches this sale. Ask an owner or manager to approve again.");
    if (action === "pay") setShowPay(false);
    setStatus("Manager approval is required for this discount.");
  }

  async function holdCart(approvalToken?: string): Promise<boolean> {
    setStatus("");
    if (offline) {
      setStatus("Holding carts requires connectivity.");
      return false;
    }
    try {
      await holdPosSale({
        cart,
        registerId,
        customerId,
        walkIn,
        orderDiscountMinor,
        approvalToken,
        existingDraftId: activeDraft?.id,
      });
      setCart([]);
      setActiveDraft(null);
      setOrderDiscountMinor(0);
      setCustomerId("");
      setCustomerQ("");
      setWalkIn("");
      await heldSalesQuery.refetch();
      setStatus("Sale held. Open Held sales to resume it later.");
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === "FORBIDDEN" && discountSummary.totalDiscountMinor > 0) {
        requireManagerApproval("hold", Boolean(approvalToken));
      } else {
        setStatus(err instanceof ApiError ? posSaleErrorMessage(err.code, err.message, discountSummary.totalDiscountMinor > 0) : "Hold failed");
      }
      return false;
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
    if (discountSummary.totalDiscountMinor > 0) {
      setStatus("Reconnect before completing a discounted sale. Discount authorization must be checked by the server.");
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
        orderDiscountMinor,
      });
      setCart([]);
      setOrderDiscountMinor(0);
      setReceived("");
      setShowPay(false);
      setStatus(
        `Sale queued offline. Provisional receipt ${queued.provisionalReceipt} — pending sync, not yet final. Review it on the sync page.`,
      );
    } catch {
      setStatus("Could not queue the offline sale.");
    }
  }

  async function pay(approvalToken?: string): Promise<boolean> {
    setStatus("");
    setReceiptId(null);
    setReconcileId(null);
    setReconcileSaleId(null);
    if (cart.length === 0) {
      setStatus("Cart is empty.");
      return false;
    }
    if (offline) {
      if (activeDraft) {
        setStatus("Reconnect before completing this resumed held sale.");
        return false;
      }
      await payOffline();
      return true;
    }
    if (isPayMongoMethodKey(method) && !methodAvailable(method)) {
      setStatus("PayMongo is not configured for this payment method yet.");
      return false;
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
        orderDiscountMinor,
        approvalToken,
        existingDraft: activeDraft ?? undefined,
      });
      if (result.kind === "redirect") {
        setStatus("Redirecting to PayMongo secure checkout…");
        window.location.assign(result.checkoutUrl);
        return true;
      }
      if (result.kind === "unknown") {
        setActiveDraft(null);
        setReconcileId(result.paymentId);
        setReconcileSaleId(result.saleId);
        setShowPay(false);
        setStatus("Payment status unknown. Do not retry blindly — reconcile payment " + (result.paymentId ?? "") + " when the provider responds.");
        return true;
      }
      setCart([]);
      setActiveDraft(null);
      setOrderDiscountMinor(0);
      setReceived("");
      setShowPay(false);
      setReconcileSaleId(null);
      setReceiptId(result.saleId);
      setStatus("Sale completed.");
      return true;
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "FORBIDDEN" && discountSummary.totalDiscountMinor > 0) {
          requireManagerApproval("pay", Boolean(approvalToken));
        } else {
          setStatus(posSaleErrorMessage(err.code, err.message, discountSummary.totalDiscountMinor > 0));
        }
      } else {
        setStatus("Payment failed");
      }
      return false;
    } finally {
      setPaying(false);
    }
  }

  async function approveDiscount(token: string): Promise<boolean> {
    if (!approvalRequest) return false;
    const action = approvalRequest;
    setStatus(`Manager approved this discount. Continuing ${action === "pay" ? "payment" : "hold"}…`);
    const completed = action === "pay" ? await pay(token) : await holdCart(token);
    if (completed) {
      discountApprovedRef.current = true;
      setApprovalRequest(null);
    }
    return completed;
  }

  const items = offline
    ? filterOfflineCatalog(cachedItems, q, activeCategoryId)
    : (searchQuery.data?.items ?? []);
  const count = cart.reduce((n, c) => n + c.qty, 0);
  const statusView = paymentPresentation(status);
  const canPay = canPresentPayAction(cart.length, canSell) && due > 0 && reconcileId === null && !(offline && resumedSaleLocked);
  const selectedRegisterName =
    scopedRegisters.find((register) => register.id === registerId)?.name ?? "—";

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
            onChange={(e) => setSaleRegister(e.target.value)}
            disabled={resumedSaleLocked}
            className="max-w-28 bg-transparent font-data text-[8px] font-medium text-[#746960] outline-none"
          >
            <option value="">—</option>
            {scopedRegisters.map((register) => (
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
          registers={scopedRegisters}
          query={q}
          activeCategoryId={activeCategoryId}
          categories={categoriesQuery.data?.items ?? []}
          products={items}
          selectedProductIds={new Set(cart.map((item) => item.productId))}
          loading={searchQuery.isLoading}
          offline={offline}
          saleLocked={resumedSaleLocked}
          catalogAt={catalogAt}
          connectivityBanner={offline && store ? <div className="mt-3"><ConnectivityBanner store={store} /></div> : null}
          onRegisterChange={setSaleRegister}
          onQueryChange={setQ}
          onSearch={() => void searchQuery.refetch()}
          onCategoryChange={setActiveCategoryId}
          onAddProduct={addToCart}
          onAssignCustomer={openCustomerAssignment}
        />
        <PosCartPanel
          cart={cart}
          count={count}
          subtotalMinor={discountSummary.grossMinor}
          discountMinor={discountSummary.totalDiscountMinor}
          due={due}
          selectedRegisterName={selectedRegisterName}
          canSell={canSell}
          canPay={canPay}
          offline={offline}
          saleLocked={resumedSaleLocked}
          heldCount={heldSalesQuery.data?.items.length ?? 0}
          effectiveMethod={effectiveMethod}
          status={status}
          statusTone={statusView.tone}
          receiptId={receiptId}
          reconcileId={reconcileId}
          reconcileSaleId={reconcileSaleId}
          methodAvailable={methodAvailable}
          onHold={() => void holdCart()}
          onOpenHeldSales={openHeldSales}
          onOpenDiscounts={openDiscounts}
          onClearCart={() => { setCart([]); setOrderDiscountMinor(0); }}
          onResetSale={() => { setCart([]); setOrderDiscountMinor(0); setStatus(''); setReceiptId(null); }}
          onSetQty={setQty}
          onAssignCustomer={openCustomerAssignment}
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
          discountMinor={discountSummary.totalDiscountMinor}
          canPay={canPay}
          saleLocked={resumedSaleLocked}
          heldCount={heldSalesQuery.data?.items.length ?? 0}
          status={status}
          statusTone={statusView.tone}
          receiptId={receiptId}
          reconcileSaleId={reconcileSaleId}
          drawerOpen={showTabletCart}
          onOpenDrawer={() => setShowTabletCart(true)}
          onCloseDrawer={() => setShowTabletCart(false)}
          onAssignCustomer={() => {
            setShowTabletCart(false);
            openCustomerAssignment();
          }}
          onHold={() => {
            setShowTabletCart(false);
            void holdCart();
          }}
          onOpenHeldSales={() => {
            setShowTabletCart(false);
            openHeldSales();
          }}
          onOpenDiscounts={() => {
            setShowTabletCart(false);
            openDiscounts();
          }}
          onSetQty={setQty}
          onOpenPayment={() => {
            setShowTabletCart(false);
            setStatus("");
            setShowPay(true);
          }}
        />

        {showHeldSales ? (
          <PosHeldSalesDialog
            heldSales={heldSalesQuery.data?.items ?? []}
            loading={heldSalesQuery.isLoading || heldSalesQuery.isFetching}
            busySaleId={resumingSaleId}
            onResume={(held) => void resumeHeldSale(held)}
            onClose={() => resumingSaleId === null && setShowHeldSales(false)}
          />
        ) : null}

        {showDiscounts ? (
          <PosDiscountDialog
            cart={cart}
            orderDiscountMinor={orderDiscountMinor}
            onApply={({ orderDiscountMinor: nextOrderDiscount, lineDiscounts }) => {
              const nextCart = applyCartDiscounts(cart, lineDiscounts);
              setCart(nextCart);
              setOrderDiscountMinor(posDiscountSummary(nextCart, nextOrderDiscount).orderDiscountMinor);
              setShowDiscounts(false);
              setStatus("Discounts applied. Server authorization will be checked when you hold or pay.");
            }}
            onClose={() => setShowDiscounts(false)}
          />
        ) : null}

        {approvalRequest ? (
          <ManagerApprovalDialog
            open
            permission="discount.override"
            action={{ kind: "discount", lines: cart.map((entry) => ({ productId: entry.productId, qty: entry.qty, lineDiscountMinor: entry.lineDiscountMinor })), orderDiscountMinor }}
            title={`Manager approval · approve ₱${(discountSummary.totalDiscountMinor / 100).toFixed(2)} discount`}
            description={`This ${approvalRequest === "pay" ? "payment" : "held sale"} includes discounts above the cashier threshold.`}
            summary={`Discount total ₱${(discountSummary.totalDiscountMinor / 100).toFixed(2)} · exact current cart`}
            onApproved={(grant) => approveDiscount(grant.token)}
            onClose={() => {
              setApprovalRequest(null);
              if (!discountApprovedRef.current) {
                setStatus("Manager approval was canceled. The sale is still in the cart.");
              }
              discountApprovedRef.current = false;
            }}
          />
        ) : null}

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
