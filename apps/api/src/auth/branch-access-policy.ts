import type { DbPort } from "../common/db.port";

interface BranchRequest {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

const HOUSEKEEPING_GET = new Set([
  "/api/v1/me", "/api/v1/health", "/api/v1/business", "/api/v1/onboarding",
  "/api/v1/branches", "/api/v1/registers", "/api/v1/payments/methods",
  "/api/v1/auth/sessions", "/api/v1/auth/csrf", "/api/v1/products", "/api/v1/categories",
  "/api/v1/sales/held",
]);
const HOUSEKEEPING_POST = new Set([
  "/api/v1/me/active-branch", "/api/v1/me/tour/seen",
  "/api/v1/auth/logout", "/api/v1/auth/confirm-password",
]);

/**
 * Branch-restricted sessions opt into a fail-closed API boundary.
 * All legacy unrestricted memberships continue using their existing flow.
 * Explicitly add audited routes only: unrestricted list/detail endpoints leak
 * data even when the UI filters by branch.
 */
export async function permitsAssignedBranchRequest(
  db: DbPort,
  req: BranchRequest,
  businessId: string,
  activeBranchId: string,
  allowedRegisterIds: string[] | null = null,
  permittedBranchIds: string[] = [activeBranchId],
): Promise<boolean> {
  const path = req.path;
  const method = req.method.toUpperCase();
  for (const supplied of [req.body?.branchId, req.query?.branchId]) {
    if (supplied !== undefined && supplied !== null && supplied !== activeBranchId) return false;
  }
  if (method === "GET" && HOUSEKEEPING_GET.has(path)) return true;
  if (method === "POST" && HOUSEKEEPING_POST.has(path)) return true;

  if (method === "GET" && path === "/api/v1/approvals/requests") return true;
  if (method === "POST" && path === "/api/v1/approvals/requests") {
    const registerId = req.body?.registerId;
    if (typeof registerId !== "string" || !registerId) return false;
    const register = await db.findRegisterById(registerId, businessId);
    return Boolean(register && register.isActive && register.branchId === activeBranchId &&
      (allowedRegisterIds === null || allowedRegisterIds.includes(register.id)));
  }
  const approvalRequestMatch = /^\/api\/v1\/approvals\/requests\/([^/]+)(?:\/(?:decision|claim))?$/.exec(path);
  if (approvalRequestMatch && (method === "GET" || method === "POST")) {
    const request = await db.findManagerApprovalRequest(decodeURIComponent(approvalRequestMatch[1]!), businessId);
    return Boolean(request && request.branchId === activeBranchId && permittedBranchIds.includes(request.branchId) &&
      (allowedRegisterIds === null || Boolean(request.registerId && allowedRegisterIds.includes(request.registerId))));
  }

  if (method === "GET" && path === "/api/v1/receipts/lookup") {
    const receiptNo = req.query?.receiptNo;
    if (typeof receiptNo !== "string" || !receiptNo.trim() || receiptNo.length > 64) return false;
    const sale = await db.findSaleByReceiptNo(receiptNo.trim(), businessId);
    return Boolean(sale && sale.branchId === activeBranchId &&
      (allowedRegisterIds === null || Boolean(sale.registerId && allowedRegisterIds.includes(sale.registerId))));
  }

  const concernInScope = (row: { branchId: string | null; registerId: string | null }): boolean =>
    row.branchId === activeBranchId && permittedBranchIds.includes(row.branchId) &&
    (allowedRegisterIds === null || Boolean(row.registerId && allowedRegisterIds.includes(row.registerId)));
  if (method === "GET" && path === "/api/v1/customer-concerns") return true;
  if (method === "GET" && path === "/api/v1/inventory/stock-exceptions") return true;
  if (method === "POST" && path === "/api/v1/inventory/stock-exceptions") {
    if (req.body) req.body.branchId = activeBranchId;
    return true;
  }
  const riskId = /^\/api\/v1\/inventory\/stock-exceptions\/([^/]+)\/dispose$/.exec(path)?.[1];
  if (riskId && method === "POST") {
    const risk = await db.findStockExceptionById(decodeURIComponent(riskId), businessId);
    return Boolean(risk && risk.branchId === activeBranchId);
  }
  const concernMatch = /^\/api\/v1\/customer-concerns\/([^/]+)(?:\/decision)?$/.exec(path);
  if (concernMatch && (method === "GET" || (method === "POST" && path.endsWith("/decision")))) {
    const concern = await db.findCustomerConcernById(decodeURIComponent(concernMatch[1]!), businessId);
    return Boolean(concern && concernInScope(concern));
  }
  if (method === "POST" && path === "/api/v1/customer-concerns") {
    const saleId = req.body?.saleId;
    if (typeof saleId !== "string") return false;
    const sale = await db.findSaleById(saleId, businessId);
    return Boolean(sale && concernInScope({ branchId: sale.branchId ?? null, registerId: sale.registerId ?? null }));
  }

  // Reports aggregate all registers by default. Until they support a safe
  // multi-register filter, only branch-limited (not register-limited) users
  // may request register-financial reports.
  if (allowedRegisterIds !== null &&
    method === "GET" &&
    (path === "/api/v1/reports/sales" || path === "/api/v1/reports/cash")) return false;

  if (method === "GET" && (
    path === "/api/v1/inventory/balances" ||
    /^\/api\/v1\/inventory\/products\/[^/]+\/movements$/.test(path) ||
    path === "/api/v1/orders" ||
    path === "/api/v1/sales" ||
    path === "/api/v1/shifts" ||
    path === "/api/v1/reports/sales" ||
    path === "/api/v1/reports/inventory" ||
    path === "/api/v1/reports/cash" ||
    path === "/api/v1/inventory/counts" ||
    path === "/api/v1/inventory/replenishment" ||
    path === "/api/v1/purchase-orders"
  )) return true;

  const countId = /^\/api\/v1\/inventory\/counts\/([^/]+)(?:\/(?:start|lines|submit|approve|post|cancel))?$/.exec(path)?.[1];
  if (countId && ["GET", "POST", "PATCH"].includes(method)) {
    const count = await db.findInventoryCountById(decodeURIComponent(countId), businessId);
    return Boolean(count && count.branchId === activeBranchId);
  }

  if (method === "POST" && path === "/api/v1/inventory/counts") {
    if (req.body) req.body.branchId = activeBranchId;
    return true;
  }
  if (method === "POST" && path === "/api/v1/inventory/replenishment/draft-po") {
    if (req.body) req.body.branchId = activeBranchId;
    return true;
  }

  const purchaseOrderId = /^\/api\/v1\/purchase-orders\/([^/]+)(?:\/(?:order|cancel|events|receipts))?$/.exec(path)?.[1];
  if (purchaseOrderId && ["GET", "POST", "PATCH"].includes(method)) {
    const order = await db.findPurchaseOrderById(decodeURIComponent(purchaseOrderId), businessId);
    return Boolean(order && order.branchId === activeBranchId);
  }
  if (method === "POST" && path === "/api/v1/purchase-orders") {
    if (req.body) req.body.branchId = activeBranchId;
    return true;
  }

  const permitsBothTransferBranches = (from: string, to: string): boolean =>
    from !== to && permittedBranchIds.includes(from) && permittedBranchIds.includes(to);
  if (method === "GET" && path === "/api/v1/transfers") return true;
  if (method === "POST" && path === "/api/v1/transfers") {
    const from = req.body?.fromBranchId;
    const to = req.body?.toBranchId;
    return typeof from === "string" && typeof to === "string" && permitsBothTransferBranches(from, to);
  }
  const transferId = /^\/api\/v1\/transfers\/([^/]+)(?:\/(?:dispatch|receive|cancel))?$/.exec(path)?.[1];
  if (transferId && ["GET", "POST"].includes(method)) {
    const transfer = await db.findTransferById(decodeURIComponent(transferId), businessId);
    return Boolean(transfer && permitsBothTransferBranches(transfer.fromBranchId, transfer.toBranchId));
  }

  if (method === "POST" && path === "/api/v1/inventory/movements") return true;
  if (method === "GET" && (
    /^\/api\/v1\/products\/barcode\/[^/]+$/.test(path) ||
    /^\/api\/v1\/products\/[^/]+$/.test(path)
  )) return true;

  const orderId = /^\/api\/v1\/orders\/([^/]+)(?:\/.+)?$/.exec(path)?.[1];
  if (orderId && ["GET", "POST"].includes(method)) {
    const order = await db.findOrderById(decodeURIComponent(orderId), businessId);
    return Boolean(order && order.branchId === activeBranchId);
  }
  const saleMatch = /^\/api\/v1\/(?:sales|receipts)\/([^/]+)(?:\/(?:hold|resume|void|refund-request|refund-approve|refund-reject|exchange|paymongo\/checkout|download|deliveries|share|email))?$/.exec(path);
  const permittedSaleMutation = method === "POST" &&
    /\/(?:hold|resume|void|refund-request|refund-approve|refund-reject|exchange|paymongo\/checkout|share|email)$/.test(path);
  if (saleMatch && (method === "GET" || permittedSaleMutation)) {
    const sale = await db.findSaleById(decodeURIComponent(saleMatch[1]!), businessId);
    return Boolean(sale && sale.branchId === activeBranchId &&
      (allowedRegisterIds === null || Boolean(sale.registerId && allowedRegisterIds.includes(sale.registerId))));
  }
  const shiftMatch = /^\/api\/v1\/shifts\/([^/]+)(?:\/(?:cash|close|corrections))?$/.exec(path);
  if (shiftMatch && ["GET", "POST"].includes(method)) {
    const shift = await db.findShiftById(decodeURIComponent(shiftMatch[1]!), businessId);
    return Boolean(shift && shift.branchId === activeBranchId &&
      (allowedRegisterIds === null || allowedRegisterIds.includes(shift.registerId)));
  }

  if (method === "POST" && path === "/api/v1/sales/drafts") {
    const registerId = req.body?.registerId;
    if (typeof registerId !== "string" || !registerId) return false;
    const register = await db.findRegisterById(registerId, businessId);
    if (!register || register.branchId !== activeBranchId || !register.isActive ||
        (allowedRegisterIds !== null && !allowedRegisterIds.includes(registerId))) return false;
    // The POS draft service uses body.branchId rather than session context.
    if (req.body) req.body.branchId = activeBranchId;
    return true;
  }
  if (method === "POST" && path === "/api/v1/sales/complete") {
    const saleId = req.body?.saleId;
    if (typeof saleId !== "string") return false;
    const sale = await db.findSaleById(saleId, businessId);
    if (!sale || sale.branchId !== activeBranchId ||
        (allowedRegisterIds !== null && (!sale.registerId || !allowedRegisterIds.includes(sale.registerId)))) return false;
    if (req.body?.registerId) {
      const register = await db.findRegisterById(String(req.body.registerId), businessId);
      if (!register || register.branchId !== activeBranchId ||
          (allowedRegisterIds !== null && !allowedRegisterIds.includes(register.id))) return false;
    }
    if (req.body) req.body.branchId = activeBranchId;
    return true;
  }
  const registerMatch = /^\/api\/v1\/registers\/([^/]+)\/open$/.exec(path);
  if (method === "POST" && registerMatch) {
    const register = await db.findRegisterById(decodeURIComponent(registerMatch[1]!), businessId);
    return Boolean(register && register.branchId === activeBranchId && register.isActive &&
      (allowedRegisterIds === null || allowedRegisterIds.includes(register.id)));
  }
  // All other routes remain forbidden for assigned staff until branch-safe.
  return false;
}
