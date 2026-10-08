"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { cartTotal } from "../../lib/sales";
import { canPresentPayAction, paymentPresentation, posSaleErrorMessage } from "../../lib/pos-view";
import {
  addProductToCart,
  changeCartQuantity,
  filterOfflineCatalog,
  heldSaleToCart,
  isPayMongoMethodKey,
  posDiscountSummary,
  resolveTenderedMinor,
  type PosCartEntry,
  type PosGiftCardLoad,
  type PosHeldSale,
  type PosProduct,
} from "../../lib/pos-sale-model";
import { holdPosSale, resumePosSale } from "../../lib/pos-operations";
import { usePosData } from "../../lib/use-pos-data";
import { usePosOffline } from "../../lib/use-pos-offline";
import { registersForBranch } from "../../lib/workspace-branch";
import { runPosCheckout } from "./pos-checkout-flow";

const METHODS: Array<{ key: string; label: string; tile: string }> = [
  { key: "cash", label: "Cash", tile: "bg-[#f35d3f]" },
  { key: "card", label: "Card", tile: "bg-[#776b62]" },
  { key: "gcash", label: "GCash", tile: "bg-[#3468d4]" },
  { key: "maya", label: "Maya", tile: "bg-[#1f8a5b]" },
  { key: "qrph", label: "QR Ph", tile: "bg-[#6554c0]" },
  { key: "bank_transfer", label: "Bank transfer", tile: "bg-[#3468d4]" },
  { key: "gift_card", label: "Gift card", tile: "bg-[#bd6b2e]" },
  { key: "store_credit", label: "Store credit", tile: "bg-[#2e8b78]" },
  { key: "loyalty", label: "Loyalty", tile: "bg-[#8a5bb8]" },
  { key: "other", label: "Other", tile: "bg-[#5d534b]" },
];

export function usePosPageController() {

  const [q, setQ] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState("");
  const [cart, setCart] = useState<PosCartEntry[]>([]);
  const [method, setMethod] = useState("cash");
  const [received, setReceived] = useState("");
  const [internalInstrumentId, setInternalInstrumentId] = useState("");
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
  const [giftCardLoad, setGiftCardLoad] = useState<PosGiftCardLoad | null>(null);
  const [showGiftCardLoad, setShowGiftCardLoad] = useState(false);
  const [giftCardResult, setGiftCardResult] = useState<{ code: string; amountMinor: number } | null>(null);

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
  const merchandiseDue = cartTotal(cart.map((c) => ({ qty: c.qty, priceMinor: c.priceMinor, lineDiscountMinor: c.lineDiscountMinor }))) - discountSummary.orderDiscountMinor;
  const giftCardLoadMinor = giftCardLoad?.amountMinor ?? 0;
  const cartDue = merchandiseDue + giftCardLoadMinor;
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
  const paymentTiles = METHODS.filter((entry) => configuredMethodKeys.has(entry.key)).filter((entry) => !giftCardLoad || !["gift_card", "store_credit", "loyalty"].includes(entry.key));

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

  async function searchOrScan(): Promise<void> {
    const scanned = q.trim();
    if (scanned !== "") {
      try {
        const product = await apiFetch<PosProduct>(`/api/v1/products/barcode/${encodeURIComponent(scanned)}`);
        addToCart(product);
        setQ("");
        setStatus(`${product.name} added from barcode scan.`);
        return;
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "NOT_FOUND") {
          setStatus("Barcode lookup failed. Check connectivity and try again.");
          return;
        }
      }
    }
    await searchQuery.refetch();
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

  function openGiftCardLoad(): void {
    if (offline) {
      setStatus("Reconnect to load a gift card.");
      return;
    }
    if (resumedSaleLocked) {
      lockedSaleMessage();
      return;
    }
    if (cart.length === 0) {
      setStatus("Add merchandise before adding a gift-card load. Load-only sales are not supported by the current sale contract.");
      return;
    }
    setStatus("");
    setShowGiftCardLoad(true);
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
    if (giftCardLoad) {
      setStatus("Gift-card load sales cannot be held. Complete or clear this sale first.");
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
        giftCardLoad: giftCardLoad ?? undefined,
      });
      setCart([]);
      setActiveDraft(null);
      setOrderDiscountMinor(0);
      setCustomerId("");
      setCustomerQ("");
      setWalkIn("");
      setGiftCardLoad(null);
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

  async function pay(approvalToken?: string): Promise<boolean> {
    return runPosCheckout({
      cart, registerId, customerId, walkIn, received, due, orderDiscountMinor,
      discountTotalMinor: discountSummary.totalDiscountMinor,
      method, internalInstrumentId, offline, identityLoading: meQuery.isLoading,
      store, activeDraft, giftCardLoad, methodAvailable,
    }, {
      setStatus, setReceiptId, setReconcileId, setReconcileSaleId,
      setCart, setActiveDraft, setOrderDiscountMinor, setReceived,
      setShowPay, setGiftCardLoad, setGiftCardResult, setPaying,
      requireManagerApproval,
    }, {}, approvalToken);
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

  return {
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
    giftCardLoad,
    giftCardLoadMinor,
    giftCardResult,
    heldSalesQuery,
    holdCart,
    items,
    internalInstrumentId,
    method,
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
    setRegisterId,
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
  };
}
