import { ApiError } from "../../lib/api";
import {
  checkoutFailureFromError,
  preconditionFailures,
  type PosCheckoutFailure,
} from "../../lib/pos-checkout-feedback";
import { completePosSale, queueOfflinePosSale } from "../../lib/pos-operations";
import { isPayMongoMethodKey, type PosCartEntry, type PosGiftCardLoad } from "../../lib/pos-sale-model";
import type { SyncStore } from "../../lib/sync-store";

export interface PosCheckoutInput {
  cart: PosCartEntry[];
  registerId: string;
  customerId: string;
  walkIn: string;
  received: string;
  due: number;
  orderDiscountMinor: number;
  discountTotalMinor: number;
  method: string;
  internalInstrumentId: string;
  offline: boolean;
  identityLoading: boolean;
  store: SyncStore | null;
  activeDraft: { id: string; totalMinor: number } | null;
  giftCardLoad: PosGiftCardLoad | null;
  methodAvailable: (method: string) => boolean;
}

export interface PosCheckoutEffects {
  setStatus: (message: string) => void;
  /**
   * Scoped to the open payment transaction. The payment dialog renders this in
   * a focusable alert so a failure can never be hidden behind the dialog.
   */
  setCheckoutFailure: (failure: PosCheckoutFailure | null) => void;
  setReceiptId: (id: string | null) => void;
  setConfirmedSale: (sale: { saleId: string; receiptNo?: string; amountMinor: number } | null) => void;
  setReconcileId: (id: string | null) => void;
  setReconcileSaleId: (id: string | null) => void;
  setCart: (cart: PosCartEntry[]) => void;
  setActiveDraft: (draft: null) => void;
  setOrderDiscountMinor: (minor: number) => void;
  setReceived: (value: string) => void;
  setShowPay: (visible: boolean) => void;
  setGiftCardLoad: (load: null) => void;
  setGiftCardResult: (result: { code: string; amountMinor: number }) => void;
  setPaying: (paying: boolean) => void;
  requireManagerApproval: (action: "pay" | "hold", retrying: boolean) => void;
}

interface CheckoutDependencies {
  queue?: (input: Parameters<typeof queueOfflinePosSale>[0]) => ReturnType<typeof queueOfflinePosSale>;
  complete?: (input: Parameters<typeof completePosSale>[0]) => ReturnType<typeof completePosSale>;
  redirect?: (url: string) => void;
  /**
   * The key of the in-flight attempt. The draft and the completion are both
   * addressed by it, so a retry after a lost response reaches the server's
   * idempotency ledger instead of paying again.
   */
  attemptKey?: string | null;
}

function clearPaymentResult(effects: PosCheckoutEffects): void {
  effects.setStatus("");
  effects.setCheckoutFailure(null);
  effects.setReceiptId(null);
  effects.setConfirmedSale(null);
  effects.setReconcileId(null);
  effects.setReconcileSaleId(null);
}

function fail(
  effects: PosCheckoutEffects,
  failure: PosCheckoutFailure,
  status: string = failure.message,
): false {
  effects.setCheckoutFailure(failure);
  effects.setStatus(status);
  if (failure.kind === "unknown_outcome" && failure.saleId) {
    effects.setReconcileSaleId(failure.saleId);
  }
  return false;
}

export async function runPosOfflineCheckout(
  state: PosCheckoutInput,
  effects: PosCheckoutEffects,
  deps: CheckoutDependencies = {},
): Promise<boolean> {
  clearPaymentResult(effects);
  if (state.cart.length === 0) {
    fail(effects, preconditionFailures.cartEmpty(), "Cart is empty.");
    return false;
  }
  if (state.identityLoading) {
    fail(
      effects,
      preconditionFailures.workspaceUnconfirmed(),
      "Confirming the signed-in workspace before offline checkout.",
    );
    return false;
  }
  if (!state.store) {
    fail(
      effects,
      preconditionFailures.reconnectRequired(
        "This device has no offline storage, so the sale cannot be queued. Reconnect and take the payment online.",
      ),
      "This device has no offline storage, so the sale cannot be queued.",
    );
    return false;
  }
  if (state.discountTotalMinor > 0) {
    fail(
      effects,
      preconditionFailures.reconnectRequired(
        "Reconnect before completing a discounted sale. Discount authorization must be checked by the server.",
      ),
      "Reconnect before completing a discounted sale. Discount authorization must be checked by the server.",
    );
    return false;
  }
  try {
    const queued = await (deps.queue ?? queueOfflinePosSale)({
      store: state.store,
      cart: state.cart,
      registerId: state.registerId,
      customerId: state.customerId,
      walkIn: state.walkIn,
      received: state.received,
      dueMinor: state.due,
      orderDiscountMinor: state.orderDiscountMinor,
    });
    effects.setCart([]);
    effects.setOrderDiscountMinor(0);
    effects.setReceived("");
    effects.setShowPay(false);
    effects.setStatus(
      `Sale queued offline. Provisional receipt ${queued.provisionalReceipt} — pending sync, not yet final. Review it on the sync page.`,
    );
    return true;
  } catch {
    fail(
      effects,
      preconditionFailures.reconnectRequired(
        "Could not queue the offline sale. Check this device's storage and try again.",
      ),
      "Could not queue the offline sale.",
    );
    // Nothing was queued. Reporting success would tell the cashier a sale
    // is on its way when the server never received it.
    return false;
  }
}

export async function runPosCheckout(
  state: PosCheckoutInput,
  effects: PosCheckoutEffects,
  deps: CheckoutDependencies = {},
  approvalToken?: string,
): Promise<boolean> {
  clearPaymentResult(effects);
  if (state.cart.length === 0) {
    return fail(effects, preconditionFailures.cartEmpty(), "Cart is empty.");
  }
  if (state.offline) {
    if (state.activeDraft) {
      return fail(
        effects,
        preconditionFailures.reconnectRequired("Reconnect before completing this resumed held sale."),
        "Reconnect before completing this resumed held sale.",
      );
    }
    return await runPosOfflineCheckout(state, effects, deps);
  }
  if (isPayMongoMethodKey(state.method) && !state.methodAvailable(state.method)) {
    return fail(
      effects,
      preconditionFailures.providerSetupRequired(
        "PayMongo is not configured for this payment method yet.",
      ),
      "PayMongo is not configured for this payment method yet.",
    );
  }
  if (state.giftCardLoad && ["gift_card", "store_credit", "loyalty"].includes(state.method)) {
    return fail(
      effects,
      preconditionFailures.internalTenderRequired(),
      "Gift-card loads must be paid with an external tender.",
    );
  }
  effects.setPaying(true);
  try {
    const result = await (deps.complete ?? completePosSale)({
      cart: state.cart,
      registerId: state.registerId,
      customerId: state.customerId,
      walkIn: state.walkIn,
      received: state.received,
      method: state.method,
      internalInstrumentId: state.internalInstrumentId.trim() || undefined,
      orderDiscountMinor: state.orderDiscountMinor,
      approvalToken,
      existingDraft: state.activeDraft ?? undefined,
      giftCardLoad: state.giftCardLoad ?? undefined,
    }, { idempotencyKey: deps.attemptKey ?? null });
    if (result.kind === "redirect") {
      effects.setStatus("Redirecting to PayMongo secure checkout…");
      (deps.redirect ?? ((url: string) => window.location.assign(url)))(result.checkoutUrl);
      return true;
    }
    if (result.kind === "unknown") {
      effects.setActiveDraft(null);
      effects.setReconcileId(result.paymentId);
      effects.setReconcileSaleId(result.saleId);
      effects.setShowPay(false);
      effects.setStatus("Payment status unknown. Do not retry blindly — reconcile payment " + (result.paymentId ?? "") + " when the provider responds.");
      return true;
    }
    effects.setCart([]);
    effects.setActiveDraft(null);
    effects.setOrderDiscountMinor(0);
    effects.setReceived("");
    effects.setShowPay(false);
    effects.setReconcileSaleId(null);
    effects.setReceiptId(result.saleId);
    effects.setConfirmedSale({ saleId: result.saleId, ...(result.receiptNo ? { receiptNo: result.receiptNo } : {}), amountMinor: state.due });
    if (result.giftCardCodes?.[0] && state.giftCardLoad?.kind === "NEW") {
      effects.setGiftCardResult({ code: result.giftCardCodes[0], amountMinor: state.giftCardLoad.amountMinor });
    }
    effects.setGiftCardLoad(null);
    effects.setStatus("Sale completed.");
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.code === "FORBIDDEN" && state.discountTotalMinor > 0) {
      effects.requireManagerApproval("pay", Boolean(approvalToken));
      return false;
    }
    return fail(effects, checkoutFailureFromError(error));
  } finally {
    effects.setPaying(false);
  }
}
