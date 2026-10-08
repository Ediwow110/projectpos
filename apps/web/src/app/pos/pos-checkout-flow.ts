import { ApiError } from "../../lib/api";
import { completePosSale, queueOfflinePosSale } from "../../lib/pos-operations";
import { isPayMongoMethodKey, type PosCartEntry, type PosGiftCardLoad } from "../../lib/pos-sale-model";
import { posSaleErrorMessage } from "../../lib/pos-view";
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
  setReceiptId: (id: string | null) => void;
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
}

function clearPaymentResult(effects: PosCheckoutEffects): void {
  effects.setStatus("");
  effects.setReceiptId(null);
  effects.setReconcileId(null);
  effects.setReconcileSaleId(null);
}

export async function runPosOfflineCheckout(
  state: PosCheckoutInput,
  effects: PosCheckoutEffects,
  deps: CheckoutDependencies = {},
): Promise<void> {
  clearPaymentResult(effects);
  if (state.cart.length === 0) {
    effects.setStatus("Cart is empty.");
    return;
  }
  if (state.identityLoading) {
    effects.setStatus("Confirming the signed-in workspace before offline checkout.");
    return;
  }
  if (!state.store) {
    effects.setStatus("Offline selling is unavailable until this signed-in workspace is identified.");
    return;
  }
  if (state.discountTotalMinor > 0) {
    effects.setStatus("Reconnect before completing a discounted sale. Discount authorization must be checked by the server.");
    return;
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
  } catch {
    effects.setStatus("Could not queue the offline sale.");
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
    effects.setStatus("Cart is empty.");
    return false;
  }
  if (state.offline) {
    if (state.activeDraft) {
      effects.setStatus("Reconnect before completing this resumed held sale.");
      return false;
    }
    await runPosOfflineCheckout(state, effects, deps);
    return true;
  }
  if (isPayMongoMethodKey(state.method) && !state.methodAvailable(state.method)) {
    effects.setStatus("PayMongo is not configured for this payment method yet.");
    return false;
  }
  if (state.giftCardLoad && ["gift_card", "store_credit", "loyalty"].includes(state.method)) {
    effects.setStatus("Gift-card loads must be paid with an external tender.");
    return false;
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
    });
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
    if (result.giftCardCodes?.[0] && state.giftCardLoad?.kind === "NEW") {
      effects.setGiftCardResult({ code: result.giftCardCodes[0], amountMinor: state.giftCardLoad.amountMinor });
    }
    effects.setGiftCardLoad(null);
    effects.setStatus("Sale completed.");
    return true;
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === "FORBIDDEN" && state.discountTotalMinor > 0) {
        effects.requireManagerApproval("pay", Boolean(approvalToken));
      } else {
        effects.setStatus(posSaleErrorMessage(error.code, error.message, state.discountTotalMinor > 0));
      }
    } else {
      effects.setStatus("Payment failed");
    }
    return false;
  } finally {
    effects.setPaying(false);
  }
}
