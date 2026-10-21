import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PosCartPanel } from "./PosCartPanel";

const noop = () => undefined;

describe("POS current-sale panel", () => {
  it("renders the Atlas V4 white cart with server-approved actions", () => {
    const html = renderToStaticMarkup(<PosCartPanel atlasV4 cart={[{productId:"a",name:"Oat milk",priceMinor:13500,qty:2,lineDiscountMinor:500}]}
      count={2} subtotalMinor={27000} discountMinor={500} due={26500} selectedRegisterName="Main till"
      canSell canPay offline={false} saleLocked={false} heldCount={0} effectiveMethod="cash"
      status="" statusTone="neutral" receiptId={null} reconcileId={null} reconcileSaleId={null}
      methodAvailable={() => true} onHold={noop} onOpenHeldSales={noop} onOpenDiscounts={noop}
      onClearCart={noop} onResetSale={noop} onSetQty={noop} onAssignCustomer={noop}
      onOpenPayment={noop} onSelectShortcut={noop} />);
    expect(html).toContain('data-ui="atlas-pos-cart"');
    expect(html).toContain('bg-white');
    expect(html).toContain('aria-label="Pay ₱265.00 (F5)"');
    expect(html).toContain('aria-label="Remove Oat milk"');
    expect(html).toContain("Proceed to payment");
    expect(html).toContain("−₱5.00");
  });
  it("renders the desktop cart rail with totals, payment action, and quantity controls", () => {
    const html = renderToStaticMarkup(
      <PosCartPanel
        cart={[{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 2, lineDiscountMinor: 500 }]}
        count={2}
        subtotalMinor={5000}
        due={4200}
        discountMinor={800}
        selectedRegisterName="Counter 1"
        canSell
        canPay
        offline={false}
        saleLocked={false}
        heldCount={1}
        effectiveMethod="cash"
        status=""
        statusTone="neutral"
        receiptId={null}
        reconcileId={null}
        reconcileSaleId={null}
        methodAvailable={() => true}
        onHold={noop}
        onOpenHeldSales={noop}
        onOpenDiscounts={noop}
        onClearCart={noop}
        onResetSale={noop}
        onSetQty={noop}
        onAssignCustomer={noop}
        onOpenPayment={noop}
        onSelectShortcut={noop}
      />,
    );

    expect(html).toContain('aria-label="Cart"');
    expect(html).toContain("Current sale");
    expect(html).toContain("Coffee");
    expect(html).toContain("−₱8.00");
    expect(html).toContain("Discounts");
    expect(html).toContain("Pay ₱42.00");
    expect(html).toContain('aria-label="Decrease Coffee"');
    expect(html).toContain('aria-label="Increase Coffee"');
    expect(html).toContain('aria-label="Remove Coffee"');
    expect(html).toContain("Qty 2 × ₱25.00");
  });

  it("keeps unresolved payment and receipt recovery links visible in the rail", () => {
    const html = renderToStaticMarkup(
      <PosCartPanel
        cart={[]}
        count={0}
        subtotalMinor={0}
        due={0}
        discountMinor={0}
        selectedRegisterName="—"
        canSell
        canPay={false}
        offline={false}
        saleLocked={false}
        heldCount={0}
        effectiveMethod="cash"
        status="Payment status unknown. Do not retry blindly."
        statusTone="warn"
        receiptId="sale-receipt"
        reconcileId="pay-1"
        reconcileSaleId="sale-unknown"
        methodAvailable={() => true}
        onHold={noop}
        onOpenHeldSales={noop}
        onOpenDiscounts={noop}
        onClearCart={noop}
        onResetSale={noop}
        onSetQty={noop}
        onAssignCustomer={noop}
        onOpenPayment={noop}
        onSelectShortcut={noop}
      />,
    );

    expect(html).toContain("/sales/sale-unknown");
    expect(html).toContain("Review unknown payment");
    expect(html).toContain("/receipts/sale-receipt");
  });

  it("keeps every Atlas V4 cart control on the 44px touch contract", () => {
    const html = renderToStaticMarkup(<PosCartPanel atlasV4 cart={[{ productId: "a", name: "Oat milk", priceMinor: 13500, qty: 2, lineDiscountMinor: 0 }]}
      count={2} subtotalMinor={27000} discountMinor={0} due={27000} selectedRegisterName="Main till"
      canSell canPay offline={false} saleLocked={false} heldCount={0} effectiveMethod="cash"
      status="" statusTone="neutral" receiptId={null} reconcileId={null} reconcileSaleId={null}
      methodAvailable={() => true} onHold={noop} onOpenHeldSales={noop} onOpenDiscounts={noop}
      onClearCart={noop} onResetSale={noop} onSetQty={noop} onAssignCustomer={noop}
      onOpenPayment={noop} onOpenGiftCardLoad={noop} onSelectShortcut={noop} />);

    expect(html).toContain("grid size-11 place-items-center");
    expect(html).toContain('aria-label="Increase Oat milk" class="grid size-11');
    expect(html).toContain("ml-auto min-h-11 rounded-md");
    expect(html).toContain("min-h-11 rounded-lg border border-[#e5e9e3]");
    expect(html).toContain("min-h-11 w-full rounded-lg border border-[#e5e9e3]");
    expect(html).not.toMatch(/size-9|min-h-9|min-h-10\b/);
  });

  it("retires the 20px legacy steppers and the under-contrast legacy labels", () => {
    const html = renderToStaticMarkup(<PosCartPanel cart={[{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 2, lineDiscountMinor: 500 }]}
      count={2} subtotalMinor={5000} discountMinor={800} due={4200} selectedRegisterName="Counter 1"
      canSell canPay offline={false} saleLocked={false} heldCount={1} effectiveMethod="cash"
      status="" statusTone="neutral" receiptId={null} reconcileId={null} reconcileSaleId={null}
      methodAvailable={() => true} onHold={noop} onOpenHeldSales={noop} onOpenDiscounts={noop}
      onClearCart={noop} onResetSale={noop} onSetQty={noop} onAssignCustomer={noop}
      onOpenPayment={noop} onOpenGiftCardLoad={noop} onSelectShortcut={noop} />);

    expect(html).not.toContain("h-5 w-5");
    expect(html).not.toMatch(/h-\[34px\]|h-\[38px\]|h-\[42px\]/);
    expect(html).toContain("grid size-11 place-items-center");
    // The meta row wraps instead of overflowing the 390px rail with 44px steppers.
    expect(html).toContain("flex flex-wrap items-center gap-1");
    expect(html).toContain("flex min-h-[61px] items-center");
    expect(html).not.toContain("text-[#71807a]");
    expect(html).not.toContain("text-[#98a49c]");
    expect(html).not.toContain("text-[#ffb7a4]");
    expect(html).toContain("text-[var(--color-atlas-muted-strong)]");
    expect(html).toContain("text-[var(--color-atlas-accent-strong)]");
  });

  it("renders the Load-card control only when a handler exists to open it", () => {
    const base = {
      cart: [], count: 0, subtotalMinor: 0, discountMinor: 0, due: 0, selectedRegisterName: "—",
      canSell: true, canPay: true, offline: false, saleLocked: false, heldCount: 0, effectiveMethod: "cash",
      status: "", statusTone: "neutral" as const, receiptId: null, reconcileId: null, reconcileSaleId: null,
      methodAvailable: () => true, onHold: noop, onOpenHeldSales: noop, onOpenDiscounts: noop,
      onClearCart: noop, onResetSale: noop, onSetQty: noop, onAssignCustomer: noop,
      onOpenPayment: noop, onSelectShortcut: noop,
    };

    expect(renderToStaticMarkup(<PosCartPanel {...base} />)).not.toContain("Load card");
    expect(renderToStaticMarkup(<PosCartPanel {...base} onOpenGiftCardLoad={noop} />)).toContain("Load card");
    expect(renderToStaticMarkup(<PosCartPanel {...base} atlasV4 />)).not.toContain("Load card");
    expect(renderToStaticMarkup(<PosCartPanel {...base} atlasV4 onOpenGiftCardLoad={noop} />)).toContain("Load card");
  });
});
