import { Inject, Injectable } from "@nestjs/common";
import type { ManagerApprovalAction } from "@pos/validation";
import type { RequestAuth } from "../../common/request-context";
import type { DbManagerApprovalRequest, DbManagerApprovalRequestCreate, DbPort } from "../../common/db.port";
import { decryptApprovalToken, encryptApprovalToken } from "../approval-token-crypto";
import { AuthService } from "./auth.service";
import { ManagerApprovalPolicyService } from "./manager-approval-policy.service";
import { lineRefundAmount } from "../../refunds/refund-math";

const REQUEST_LIFETIME_MS = 15 * 60_000;

function inScope(actor: RequestAuth, row: DbManagerApprovalRequest): boolean {
  if (actor.activeBranchId && row.branchId !== actor.activeBranchId && row.kind !== "value_adjustment") return false;
  if (actor.allowedBranchIds !== undefined && actor.allowedBranchIds !== null && !actor.allowedBranchIds.includes(row.branchId ?? "")) return false;
  if (row.registerId && actor.allowedRegisterIds !== undefined && actor.allowedRegisterIds !== null && !actor.allowedRegisterIds.includes(row.registerId)) return false;
  return true;
}

function publicRequest(row: DbManagerApprovalRequest) {
  const { tokenCiphertext: _secret, ...safe } = row;
  return safe;
}

@Injectable()
export class ManagerApprovalQueueService {
  constructor(
    @Inject("DbPort") private readonly db: DbPort,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ManagerApprovalPolicyService) private readonly policy: ManagerApprovalPolicyService,
  ) {}

  async request(
    actor: RequestAuth,
    requestId: string,
    action: ManagerApprovalAction,
    requestedRegisterId: string | null,
    idempotencyKey: string,
  ) {
    if (actor.role !== "cashier" || !idempotencyKey || idempotencyKey.length > 128) throw new Error("FORBIDDEN");
    const registerBound = ["discount", "shift_close", "refund", "sale_void"].includes(action.kind);
    if (registerBound && !requestedRegisterId) throw new Error("FORBIDDEN");
    if (!registerBound && requestedRegisterId) throw new Error("FORBIDDEN");
    if (!registerBound && !["inventory_movement", "inventory_count", "value_adjustment"].includes(action.kind)) throw new Error("FORBIDDEN");
    let normalizedAction = action;
    if (action.kind === "inventory_movement") {
      normalizedAction = { ...action, ...(action.branchId ?? actor.activeBranchId ? { branchId: action.branchId ?? actor.activeBranchId! } : {}) };
    }
    const granted = this.auth.permissionsForRequest(actor);
    const requirement = await this.policy.resolveRequirement(actor.businessId, actor.userId, normalizedAction);
    if (!requirement || granted.includes(requirement.permission)) throw new Error("FORBIDDEN");

    let branchId: string | null = null;
    let register: Awaited<ReturnType<DbPort["findRegisterById"]>> = null;
    if (requestedRegisterId) {
      register = await this.db.findRegisterById(requestedRegisterId, actor.businessId);
      if (!register || !register.isActive) throw new Error("FORBIDDEN");
      branchId = register.branchId ?? null;
    } else if (normalizedAction.kind === "inventory_movement") {
      branchId = normalizedAction.branchId ?? null;
      if (branchId) {
        const branch = await this.db.findBranchById(branchId, actor.businessId);
        if (!branch || !branch.isActive) throw new Error("FORBIDDEN");
      }
    } else if (normalizedAction.kind === "inventory_count") {
      const count = await this.db.findInventoryCountById(normalizedAction.countId, actor.businessId);
      if (!count) throw new Error("FORBIDDEN");
      if (count.status !== "SUBMITTED") throw new Error("INVALID_STATE");
      branchId = count.branchId ?? null;
    } else if (normalizedAction.kind === "value_adjustment" && actor.allowedBranchIds != null) {
      throw new Error("FORBIDDEN");
    }

    if (registerBound) {
      if (!register) throw new Error("FORBIDDEN");
      if (normalizedAction.kind === "shift_close") {
        const shift = await this.db.findShiftById(normalizedAction.shiftId, actor.businessId);
        if (!shift || shift.registerId !== register.id || shift.status !== "OPEN") throw new Error("FORBIDDEN");
      } else if (normalizedAction.kind === "refund" || normalizedAction.kind === "sale_void") {
        const sale = await this.db.findSaleById(normalizedAction.saleId, actor.businessId);
        if (!sale || sale.registerId !== register.id || (sale.branchId ?? null) !== branchId) throw new Error("FORBIDDEN");
        if (normalizedAction.kind === "refund" && sale.status !== "REFUND_REQUESTED") throw new Error("SALE_INVALID_TRANSITION");
      }
    }
    if ((actor.activeBranchId && branchId && actor.activeBranchId !== branchId) ||
      (actor.allowedBranchIds != null && (!branchId || !actor.allowedBranchIds.includes(branchId))) ||
      (actor.allowedRegisterIds != null && register && !actor.allowedRegisterIds.includes(register.id))) throw new Error("FORBIDDEN");

    return this.db.withLock(`manager-approval-request:${actor.businessId}:${actor.userId}:${idempotencyKey}`, async () => this.db.withTransaction(async (tx) => {
      const existing = await tx.findManagerApprovalRequestByIdempotency(actor.businessId, actor.userId, idempotencyKey);
      if (existing) {
        if (existing.fingerprint !== requirement.fingerprint || existing.registerId !== (register?.id ?? null) || existing.branchId !== branchId) throw new Error("IDEMPOTENCY_MISMATCH");
        return { request: publicRequest(existing), replayed: true };
      }
      const input: DbManagerApprovalRequestCreate = {
        businessId: actor.businessId,
        requesterId: actor.userId,
        branchId,
        registerId: register?.id ?? null,
        kind: normalizedAction.kind,
        permission: requirement.permission,
        action: normalizedAction as unknown as Record<string, unknown>,
        fingerprint: requirement.fingerprint,
        stateFingerprint: requirement.stateFingerprint ?? null,
        status: "PENDING",
        idempotencyKey,
        approverId: null,
        decidedAt: null,
        decisionReason: null,
        tokenCiphertext: null,
        tokenExpiresAt: null,
        tokenClaimedAt: null,
      };
      const request = await tx.createManagerApprovalRequest(input);
      await tx.appendAudit({ businessId: actor.businessId, actorId: actor.userId, action: "manager.approval.requested", entityType: "ManagerApprovalRequest", entityId: request.id, requestId,
        after: { kind: request.kind, permission: request.permission, branchId: request.branchId, registerId: request.registerId } });
      return { request: publicRequest(request), replayed: false };
    }));
  }

  async list(actor: RequestAuth) {
    const granted = this.auth.permissionsForRequest(actor);
    const reviewer = actor.role === "owner" || actor.role === "manager";
    const rows = await this.db.listManagerApprovalRequests(actor.businessId);
    const now = Date.now();
    const visible: DbManagerApprovalRequest[] = [];
    for (const row of rows) {
      if (!inScope(actor, row)) continue;
      if (reviewer) {
        if (!granted.includes(row.permission)) continue;
      } else if (row.requesterId !== actor.userId) continue;
      if (row.status === "PENDING" && now - row.createdAt.getTime() >= REQUEST_LIFETIME_MS) {
        const expired = await this.db.transitionManagerApprovalRequest(row.id, actor.businessId, "PENDING", { status: "EXPIRED", decisionReason: "Request expired before review" });
        if (expired) await this.db.appendAudit({ businessId: actor.businessId, actorId: actor.userId, action: "manager.approval.expired", entityType: "ManagerApprovalRequest", entityId: row.id, requestId: "system", before: { status: "PENDING" }, after: { status: "EXPIRED" } });
        visible.push(expired ?? { ...row, status: "EXPIRED" });
      } else visible.push(row);
    }
    return Promise.all(visible.map((row) => this.describeRequest(actor, row)));
  }

  private async describeRequest(actor: RequestAuth, row: DbManagerApprovalRequest) {
    const safe = publicRequest(row);
    const action = row.action as unknown as ManagerApprovalAction;
    const [requester, branch, register] = await Promise.all([
        this.db.findUserById(row.requesterId),
        row.branchId ? this.db.findBranchById(row.branchId, actor.businessId) : null,
        row.registerId ? this.db.findRegisterById(row.registerId, actor.businessId) : null,
      ]);
      const labels = { requesterName: requester?.name ?? null, branchName: branch?.name ?? null, registerName: register?.name ?? null };
      if (action.kind === "shift_close") {
        const shift = await this.db.findShiftById(action.shiftId, actor.businessId);
        if (!shift || shift.registerId !== row.registerId || shift.branchId !== row.branchId) return { ...safe, ...labels, context: null };
        return { ...safe, ...labels, context: { expectedCashMinor: shift.expectedCashMinor, countedCashMinor: action.countedCashMinor, varianceMinor: action.countedCashMinor - shift.expectedCashMinor } };
      }
      if (action.kind === "refund" || action.kind === "sale_void") {
        const sale = await this.db.findSaleById(action.saleId, actor.businessId);
        if (!sale || sale.registerId !== row.registerId || (sale.branchId ?? null) !== row.branchId) return { ...safe, ...labels, context: null };
        if (action.kind === "sale_void") return { ...safe, ...labels, context: { saleReceiptNo: sale.receiptNo, saleStatus: sale.status, amountMinor: sale.totalMinor } };
        const items = await this.db.listSaleItems(sale.id, actor.businessId);
        const lineItems = action.items.map((item) => {
          const line = items.find((candidate) => candidate.id === item.saleItemId);
          return line ? { name: line.name, qty: item.qty, amountMinor: lineRefundAmount(line.lineTotalMinor, line.qty, item.qty) } : null;
        }).filter((item): item is { name: string; qty: number; amountMinor: number } => item !== null);
        const amountMinor = lineItems.reduce((sum, item) => sum + item.amountMinor, 0)
          + (action.loadRefunds ?? []).reduce((sum, item) => sum + item.amountMinor, 0)
          + (action.deliveryRefundMinor ?? 0);
        return { ...safe, ...labels, context: { saleReceiptNo: sale.receiptNo, saleStatus: sale.status, amountMinor, lineItems } };
      }
      if (action.kind === "discount") {
        const discountLines = await Promise.all(action.lines.map(async (line) => {
          const product = await this.db.findProductById(line.productId, actor.businessId);
          return { name: product?.name ?? "Unavailable product", qty: line.qty, lineDiscountMinor: line.lineDiscountMinor };
        }));
        return { ...safe, ...labels, context: { discountLines } };
      }
      if (action.kind === "inventory_movement") {
        const product = await this.db.findProductById(action.productId, actor.businessId);
        return { ...safe, ...labels, context: {
          productName: product?.name ?? "Unavailable product",
          movementType: action.movementType,
          qtyDelta: action.qtyDelta,
          reason: action.reason ?? null,
        } };
      }
      if (action.kind === "inventory_count") {
        const count = await this.db.findInventoryCountById(action.countId, actor.businessId);
        if (!count || count.branchId !== row.branchId || count.status !== "SUBMITTED") return { ...safe, ...labels, context: null };
        const lines = await this.db.listInventoryCountLines(count.id, actor.businessId);
        return { ...safe, ...labels, context: {
          countNumber: count.countNumber,
          countStatus: count.status,
          varianceLines: lines.filter((line) => line.varianceQty !== null && line.varianceQty !== 0).map((line) => ({
            name: line.productNameSnapshot,
            expectedQty: line.expectedQtySnapshot,
            countedQty: line.countedQty ?? 0,
            varianceQty: line.varianceQty!,
          })),
        } };
      }
      if (action.kind === "value_adjustment") {
        const customer = action.valueType === "gift_card" ? null : await this.db.findCustomerById(action.targetId, actor.businessId);
        const giftCard = action.valueType === "gift_card" ? await this.db.findGiftCardById(action.targetId, actor.businessId) : null;
        return { ...safe, ...labels, context: {
          targetLabel: action.valueType === "gift_card" ? giftCard ? `Gift card · ${giftCard.codePrefix}••••${giftCard.codeLast4}` : "Unavailable gift card" : customer?.name ?? "Unavailable customer",
          valueType: action.valueType,
        } };
      }
      return { ...safe, ...labels };
  }

  async detail(actor: RequestAuth, id: string) {
    const row = await this.db.findManagerApprovalRequest(id, actor.businessId);
    if (!row || !inScope(actor, row)) throw new Error("NOT_FOUND");
    const reviewer = actor.role === "owner" || actor.role === "manager";
    if (reviewer
      ? !this.auth.permissionsForRequest(actor).includes(row.permission)
      : row.requesterId !== actor.userId) throw new Error("NOT_FOUND");
    // A single-item read must not expire or audit other requests.
    const expired = row.status === "PENDING" && Date.now() - row.createdAt.getTime() >= REQUEST_LIFETIME_MS;
    return this.describeRequest(actor, expired ? { ...row, status: "EXPIRED" } : row);
  }

  async decide(actor: RequestAuth, requestId: string, id: string, decision: { decision: "APPROVED"; email: string; password?: string; pin?: string } | { decision: "REJECTED"; reason: string }) {
    if (actor.role !== "owner" && actor.role !== "manager") throw new Error("FORBIDDEN");
    const row = await this.db.findManagerApprovalRequest(id, actor.businessId);
    if (!row) throw new Error("NOT_FOUND");
    if (!inScope(actor, row) || !this.auth.permissionsForRequest(actor).includes(row.permission)) throw new Error("FORBIDDEN");
    if (row.status !== "PENDING") throw new Error("INVALID_STATE");
    if (Date.now() - row.createdAt.getTime() >= REQUEST_LIFETIME_MS) {
      const expired = await this.db.transitionManagerApprovalRequest(id, actor.businessId, "PENDING", {
        status: "EXPIRED", decisionReason: "Request expired before review",
      });
      if (expired) await this.db.appendAudit({
        businessId: actor.businessId,
        actorId: actor.userId,
        action: "manager.approval.expired",
        entityType: "ManagerApprovalRequest",
        entityId: id,
        requestId,
        before: { status: "PENDING" },
        after: { status: "EXPIRED" },
      });
      throw new Error("APPROVAL_REQUEST_EXPIRED");
    }

    if (decision.decision === "REJECTED") {
      const updated = await this.db.transitionManagerApprovalRequest(id, actor.businessId, "PENDING", {
        status: "REJECTED", approverId: actor.userId, decidedAt: new Date(), decisionReason: decision.reason.trim(),
      });
      if (!updated) throw new Error("INVALID_STATE");
      await this.db.appendAudit({ businessId: actor.businessId, actorId: actor.userId, action: "manager.approval.rejected", entityType: "ManagerApprovalRequest", entityId: id, requestId,
        reason: decision.reason.trim(), before: { status: row.status }, after: { status: "REJECTED", requesterId: row.requesterId, permission: row.permission } });
      return publicRequest(updated);
    }

    const action = row.action as unknown as ManagerApprovalAction;
    const requirement = await this.policy.resolveRequirement(actor.businessId, row.requesterId, action);
    if (!requirement || requirement.permission !== row.permission || requirement.fingerprint !== row.fingerprint || (requirement.stateFingerprint ?? null) !== row.stateFingerprint) throw new Error("APPROVAL_REQUEST_STALE");
    const approver = await this.db.findUserById(actor.userId);
    if (!approver || approver.email.toLowerCase() !== decision.email.trim().toLowerCase()) throw new Error("AUTH_INVALID_CREDENTIALS");
    const grant = await this.auth.mintManagerApproval(actor.businessId, row.requesterId, requestId, {
      email: decision.email,
      ...(decision.password ? { password: decision.password } : {}),
      ...(decision.pin ? { pin: decision.pin } : {}),
      permission: requirement.permission,
      fingerprint: requirement.fingerprint,
      requireDistinctApprover: requirement.requireDistinctApprover,
    });
    const encryptedToken = encryptApprovalToken(grant.token, process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"]);
    const updated = await this.db.transitionManagerApprovalRequest(id, actor.businessId, "PENDING", {
      status: "APPROVED", approverId: actor.userId, decidedAt: new Date(), tokenCiphertext: encryptedToken, tokenExpiresAt: grant.expiresAt,
    });
    if (!updated) throw new Error("INVALID_STATE");
    await this.db.appendAudit({ businessId: actor.businessId, actorId: actor.userId, action: "manager.approval.approved", entityType: "ManagerApprovalRequest", entityId: id, requestId,
      reason: row.permission, before: { status: row.status }, after: { status: "APPROVED", requesterId: row.requesterId, permission: row.permission, expiresAt: grant.expiresAt } });
    return publicRequest(updated);
  }

  async claim(actor: RequestAuth, id: string) {
    return this.db.withLock(`manager-approval-claim:${actor.businessId}:${id}`, () =>
      this.db.withTransaction(async (tx) => {
        const now = new Date();
        const row = await tx.findManagerApprovalRequest(id, actor.businessId);
        if (!row || row.requesterId !== actor.userId || row.status !== "APPROVED" ||
          !row.tokenCiphertext || !row.tokenExpiresAt || row.tokenExpiresAt <= now || row.tokenClaimedAt) {
          throw new Error("APPROVAL_TOKEN_UNAVAILABLE");
        }
        const approver = row.approverId ? await tx.findUserById(row.approverId) : null;
        const membership = approver ? await tx.findMembership(approver.id, actor.businessId) : null;
        if (!approver || !membership || membership.deactivatedAt ||
          (membership.role !== "owner" && membership.role !== "manager")) {
          throw new Error("APPROVAL_TOKEN_UNAVAILABLE");
        }
        let token: string;
        try {
          token = decryptApprovalToken(row.tokenCiphertext, process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"]);
        } catch {
          // Keep the ciphertext for a corrected key or a fresh approval request.
          throw new Error("APPROVAL_TOKEN_UNAVAILABLE");
        }
        // The adapter's conditional, atomic claim remains the cross-process
        // authority if a competing worker changes the row during validation.
        const claimed = await tx.claimManagerApprovalRequestToken(id, actor.businessId, actor.userId, now);
        if (!claimed) throw new Error("APPROVAL_TOKEN_UNAVAILABLE");
        return { token, expiresAt: claimed.tokenExpiresAt.toISOString(),
          approver: { id: approver.id, name: approver.name, role: membership.role } };
      }));
  }
}
