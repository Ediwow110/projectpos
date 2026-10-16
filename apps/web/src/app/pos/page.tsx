"use client";

import type { JSX } from "react";
import { applyCartDiscounts, posDiscountSummary } from "../../lib/pos-sale-model";
import { ConnectivityBanner } from "../../lib/sync-ui";
import { AppShell } from "../../components/AppShell";
import { PosCartPanel } from "../../components/PosCartPanel";
import { PosCustomerDialog } from "../../components/PosCustomerDialog";
import { PosDiscountDialog } from "../../components/PosDiscountDialog";
import { PosHeldSalesDialog } from "../../components/PosHeldSalesDialog";
import { ManagerApprovalDialog } from "../../components/ManagerApprovalDialog";
import { PosPaymentWorkspace } from "../../components/PosPaymentWorkspace";
import { PosProductCatalog } from "../../components/PosProductCatalog";
import { PosResponsiveCart } from "../../components/PosResponsiveCart";
import { GiftCardLoadDialog } from "../../components/GiftCardLoadDialog";
import { GiftCardLoadResultDialog } from "../../components/GiftCardLoadResultDialog";
import { usePosPageController } from "./use-pos-page-controller";

export default function PosPage(): JSX.Element {
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

  return (
    <AppShell
      businessName={meQuery.data?.businessName}
      role={role}
      offline={offline}
      posMode
      atlasPos
    >
      <div className="min-w-0 pb-[124px] text-[#202826] lg:pb-5 xl:pb-0">
        <div className="flex min-h-[80px] w-full flex-wrap items-center justify-between gap-3 border-b border-[#e5e9e3] bg-white px-4 py-3 sm:px-7 xl:px-[34px]">
          <h1 className="font-display text-[24px] font-semibold tracking-tight text-[#202826]">New sale</h1>
          <label className="hidden items-center gap-2 font-data text-xs font-medium text-[#267552] sm:inline-flex">
            <span>REGISTER</span>
            <select aria-label="Register" value={registerId} disabled={resumedSaleLocked} onChange={(e) => setSaleRegister(e.target.value)} className="max-w-[180px] rounded-lg border border-[#e5e9e3] bg-white px-2 py-2 text-xs font-medium text-[#202826]">
              <option value="">Select register</option>
              {scopedRegisters.map((register) => <option key={register.id} value={register.id}>{register.name}</option>)}
            </select>
          </label>
          <p className="hidden max-w-[180px] truncate text-xs text-[#53615a] lg:block">{meQuery.data?.businessName || "NexPOS"}</p>
        </div>
        <main
          className="grid min-w-0 bg-[#f7f8f5] xl:min-h-[calc(100vh-80px)] xl:grid-cols-[minmax(0,1fr)_456px]"
        >
        <PosProductCatalog
          atlasV4
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
          atlasV4
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
          onResetSale={() => { setCart([]); setOrderDiscountMinor(0); setGiftCardLoad(null); setStatus(''); setReceiptId(null); }}
          onSetQty={setQty}
          onAssignCustomer={openCustomerAssignment}
          onOpenPayment={() => { setStatus(''); setShowPay(true); }}
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
          atlasV4
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
            setStatus("");
            setShowPay(true);
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

        {showPay ? (
          <PosPaymentWorkspace
            atlasV4
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
            onClose={() => setShowPay(false)}
            onPay={() => void pay()}
          />
        ) : null}
        {showGiftCardLoad ? <GiftCardLoadDialog onClose={() => setShowGiftCardLoad(false)} onSave={(load) => { setGiftCardLoad(load); setShowGiftCardLoad(false); setMethod("cash"); setStatus("Gift-card load added. It will be funded only after payment completes."); }} /> : null}
        {giftCardResult ? <GiftCardLoadResultDialog code={giftCardResult.code} amountMinor={giftCardResult.amountMinor} onClose={() => setGiftCardResult(null)} /> : null}
      </div>
    </AppShell>
  );
}
