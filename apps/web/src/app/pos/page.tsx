"use client";

import { useEffect, useRef, useState, type JSX } from "react";
import { applyCartDiscounts, posDiscountSummary } from "../../lib/pos-sale-model";
import { ConnectivityBanner } from "../../lib/sync-ui";
import { AppShell } from "../../components/AppShell";
import { PosCartPanel } from "../../components/PosCartPanel";
import { PosCustomerDialog } from "../../components/PosCustomerDialog";
import { PosDiscountDialog } from "../../components/PosDiscountDialog";
import { PosHeldSalesDialog } from "../../components/PosHeldSalesDialog";
import { ManagerApprovalDialog } from "../../components/ManagerApprovalDialog";
import { PosPaymentWorkspace } from "../../components/PosPaymentWorkspace";
import { PosPaymentMethodChooser } from "../../components/PosPaymentMethodChooser";
import { PosSaleConfirmedDialog } from "../../components/PosSaleConfirmedDialog";
import { PosPaymentUnknownDialog } from "../../components/PosPaymentUnknownDialog";
import { PosProductCatalog } from "../../components/PosProductCatalog";
import { PosResponsiveCart } from "../../components/PosResponsiveCart";
import { GiftCardLoadDialog } from "../../components/GiftCardLoadDialog";
import { GiftCardLoadResultDialog } from "../../components/GiftCardLoadResultDialog";
import { usePosPageController } from "./use-pos-page-controller";

export default function PosPage(): JSX.Element {
  const [paymentChooserOpen, setPaymentChooserOpen] = useState(false);
  const [unknownDialogDismissedFor, setUnknownDialogDismissedFor] = useState<string | null>(null);
  const paymentOpener = useRef<HTMLElement | null>(null);
  const {
    activeCategoryId,
    addToCart,
    approvalRequest,
    approveDiscount,
    cart,
    catalogAt,
    canPay,
    canSell,
    categoriesQuery,
    changeMinor,
    count,
    customerId,
    customerQ,
    customersQuery,
    discountApprovedRef,
    discountSummary,
    due,
    effectiveMethod,
    giftCardLoadMinor,
    giftCardResult,
    heldSalesQuery,
    holdCart,
    items,
    internalInstrumentId,
    methodAvailable,
    meQuery,
    now,
    offline,
    openCustomerAssignment,
    openDiscounts,
    openGiftCardLoad,
    openHeldSales,
    orderDiscountMinor,
    pay,
    paying,
    paymentTiles,
    q,
    receiptId,
    confirmedSale,
    received,
    reconcileId,
    reconcileSaleId,
    registerId,
    resumedSaleLocked,
    resumingSaleId,
    resumeHeldSale,
    role,
    scopedRegisters,
    searchOrScan,
    searchQuery,
    selectedRegisterName,
    setActiveCategoryId,
    setApprovalRequest,
    setCart,
    setCustomerId,
    setReceiptId,
    setConfirmedSale,
    setCustomerQ,
    setGiftCardLoad,
    setGiftCardResult,
    setInternalInstrumentId,
    setMethod,
    setOrderDiscountMinor,
    setQ,
    setReceived,
    setSaleRegister,
    setQty,
    setShowCustomer,
    setShowDiscounts,
    setShowGiftCardLoad,
    setShowHeldSales,
    setShowPay,
    setShowTabletCart,
    setStatus,
    setWalkIn,
    walkIn,
    showCustomer,
    showDiscounts,
    showGiftCardLoad,
    showHeldSales,
    showPay,
    showTabletCart,
    status,
    statusView,
    store,
  } = usePosPageController();

  useEffect(() => {
    if (!paymentChooserOpen) return;
    const desktop = window.matchMedia("(min-width: 1280px)");
    const followViewport = (): void => {
      if (desktop.matches) return;
      setPaymentChooserOpen(false);
      setShowPay(true);
    };
    desktop.addEventListener("change", followViewport);
    followViewport();
    return () => desktop.removeEventListener("change", followViewport);
  }, [paymentChooserOpen, setShowPay]);

  function openPaymentFlow(): void {
    const opener = document.activeElement;
    if (opener instanceof HTMLElement) paymentOpener.current = opener;
    setStatus("");
    if (window.matchMedia("(min-width: 1280px)").matches) {
      setPaymentChooserOpen(true);
    } else {
      setShowPay(true);
    }
  }

  function closePaymentDetails(): void {
    setShowPay(false);
    requestAnimationFrame(() => {
      const target = paymentOpener.current;
      if (target?.isConnected && target.getClientRects().length) target.focus();
      else document.getElementById("pos-search")?.focus();
    });
  }

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
      <div className="px-3 pb-[124px] text-[#17130f] sm:px-5 lg:pb-5 lg:max-xl:px-10 xl:p-0">
        <main
          className={
            "mx-auto grid max-w-[1212px] overflow-hidden rounded-[20px] bg-[#191816] text-white shadow-[0_14px_34px_-12px_rgb(26_18_13/0.20)] xl:ml-0 xl:mr-auto xl:max-w-none xl:rounded-none xl:bg-[#f7f8f5] xl:text-[#202826] xl:shadow-none " +
            // Fluid products track: at 1280-1440px viewports the workspace
            // sidebar leaves less than 760+452px for this grid. Fixed tracks
            // overflowed and main's overflow-hidden clipped cart actions
            // (native clicks intercepted). The products pane absorbs the
            // shrink (cards reflow via auto-fill); the 452px cart column keeps
            // its pixel-positioned interior intact at every xl width.
            "lg:max-xl:h-[1090px] lg:max-xl:min-h-[1090px] xl:min-h-[max(820px,calc(100vh-80px))] xl:grid-cols-[minmax(0,1fr)_455px] xl:gap-0 " +
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
          onSearch={() => void searchOrScan()}
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
          onClearCart={() => { setCart([]); setOrderDiscountMinor(0); setGiftCardLoad(null); }}
          onResetSale={() => { setCart([]); setOrderDiscountMinor(0); setGiftCardLoad(null); setStatus(''); setReceiptId(null); setConfirmedSale(null); }}
          onSetQty={setQty}
          onAssignCustomer={openCustomerAssignment}
          onOpenPayment={openPaymentFlow}
          giftCardLoadMinor={giftCardLoadMinor}
          onOpenGiftCardLoad={openGiftCardLoad}
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
          giftCardLoadMinor={giftCardLoadMinor}
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
            openPaymentFlow();
          }}
          onOpenGiftCardLoad={openGiftCardLoad}
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
            registerId={registerId}
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

        {paymentChooserOpen && !showPay ? (
          <PosPaymentMethodChooser
            effectiveMethod={effectiveMethod}
            offline={offline}
            methodAvailable={methodAvailable}
            onMethodChange={setMethod}
            onContinue={() => { setPaymentChooserOpen(false); setShowPay(true); }}
            onMoreMethods={() => { setPaymentChooserOpen(false); setShowPay(true); }}
            onClose={() => setPaymentChooserOpen(false)}
          />
        ) : null}
        {showPay ? (
          <PosPaymentWorkspace
            count={count}
            due={due}
            giftCardLoadMinor={giftCardLoadMinor}
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
            internalInstrumentId={internalInstrumentId}
            onInternalInstrumentIdChange={setInternalInstrumentId}
            onReceivedChange={setReceived}
            onClose={closePaymentDetails}
            onPay={() => void pay()}
          />
        ) : null}
        {showGiftCardLoad ? <GiftCardLoadDialog onClose={() => setShowGiftCardLoad(false)} onSave={(load) => { setGiftCardLoad(load); setShowGiftCardLoad(false); setMethod("cash"); setStatus("Gift-card load added. It will be funded only after payment completes."); }} /> : null}
        {giftCardResult ? <GiftCardLoadResultDialog code={giftCardResult.code} amountMinor={giftCardResult.amountMinor} onClose={() => setGiftCardResult(null)} /> : null}
        {confirmedSale && !giftCardResult ? (
          <PosSaleConfirmedDialog sale={confirmedSale} onClose={() => setConfirmedSale(null)} />
        ) : null}
        {reconcileSaleId && !showPay && !giftCardResult && unknownDialogDismissedFor !== reconcileSaleId ? (
          <PosPaymentUnknownDialog
            saleId={reconcileSaleId}
            onClose={() => setUnknownDialogDismissedFor(reconcileSaleId)}
          />
        ) : null}
      </div>
    </AppShell>
  );
}
