import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type { DbCashMovement, DbPort, DbRegister, DbShift, DbShiftCorrection } from "../../common/db.port";
import { BillingService } from "../../billing/nest/billing.service";
import {
  computeExpectedCash,
  computeVariance,
  signForCash,
  sumCashComponents,
  validateCashAmount,
  type CashKind,
  type CashMovementType,
} from "../cash";

const REGISTER_MANAGERS = new Set(["owner", "manager"]);
const SHIFT_ROLES = new Set(["owner", "manager", "cashier"]);

export interface ShiftComponents {
  openingFloat: number;
  cashSales: number;
  cashRefunds: number;
  cashExpenses: number;
  cashDeposits: number;
  cashWithdrawals: number;
  adjustments: number;
  expectedCash: number;
  countedCash: number | null;
  variance: number | null;
}

export interface ShiftReport {
  shiftId: string;
  status: string;
  // Phase 9a: branch scope inherited from the register.
  branchId: string | null;
  components: ShiftComponents;
  movements: DbCashMovement[];
  expectedCash: number;
  variance: number;
}

function kindToType(kind: CashKind): CashMovementType {
  return kind;
}

@Injectable()
export class ShiftService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  private readonly locks = new Map<string, Promise<void>>();

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, prev.then(() => next));
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === next) this.locks.delete(key);
    }
  }

  private async requireRegister(businessId: string, registerId: string): Promise<DbRegister> {
    const reg = await this.db.findRegisterById(registerId, businessId);
    if (!reg) throw new Error("NOT_FOUND");
    return reg;
  }

  private async requireShift(businessId: string, shiftId: string): Promise<DbShift> {
    const shift = await this.db.findShiftById(shiftId, businessId);
    if (!shift) throw new Error("NOT_FOUND");
    return shift;
  }

  private async componentsFor(shift: DbShift): Promise<ShiftComponents> {
    const movements = await this.db.listCashMovementsByShift(shift.id, shift.businessId);
    const sums = sumCashComponents(movements);
    const expectedCash = computeExpectedCash({ openingFloat: shift.openingFloatMinor, ...sums });
    return {
      openingFloat: shift.openingFloatMinor,
      ...sums,
      expectedCash,
      countedCash: shift.countedCashMinor,
      variance: shift.varianceMinor,
    };
  }

  async createRegister(
    businessId: string,
    actorId: string,
    requestId: string,
    input: { name: string; branchId?: string | null },
    role: string,
  ): Promise<DbRegister> {
    withScope(businessId, {});
    if (!REGISTER_MANAGERS.has(role)) throw new Error("FORBIDDEN");
    const name = input.name.trim();
    if (!name) throw new Error("VALIDATION");
    let branchId: string | null = null;
    if (input.branchId !== undefined && input.branchId !== null) {
      const branch = await this.db.findBranchById(input.branchId, businessId);
      if (!branch) throw new Error("VALIDATION");
      branchId = branch.id;
    }
    const existing = await this.db.listRegisters(businessId);
    if (existing.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("VALIDATION");
    }
    const row = await new BillingService(this.db).withCap(
      businessId, actorId, requestId, "registers",
      () => this.db.createRegister({ businessId, name, isActive: true, branchId }),
    );
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "register.create",
      entityType: "Register",
      entityId: row.id,
      requestId,
    });
    return row;
  }

  async listRegisters(businessId: string): Promise<Array<DbRegister & { branchName: string | null }>> {
    withScope(businessId, {});
    const rows = await this.db.listRegisters(businessId);
    const out: Array<DbRegister & { branchName: string | null }> = [];
    for (const r of rows) {
      const branchId = r.branchId ?? null;
      const branch = branchId ? await this.db.findBranchById(branchId, businessId) : null;
      out.push({ ...r, branchId, branchName: branch?.name ?? null });
    }
    return out;
  }

  async updateRegister(
    businessId: string,
    actorId: string,
    requestId: string,
    id: string,
    patch: { name?: string; isActive?: boolean; branchId?: string | null },
    role: string,
  ): Promise<DbRegister> {
    withScope(businessId, {});
    if (!REGISTER_MANAGERS.has(role)) throw new Error("FORBIDDEN");
    const current = await this.requireRegister(businessId, id);
    void current;
    let branchPatch: { branchId?: string | null } = {};
    if (patch.branchId !== undefined) {
      if (patch.branchId === null) {
        branchPatch = { branchId: null };
      } else {
        const branch = await this.db.findBranchById(patch.branchId, businessId);
        if (!branch) throw new Error("VALIDATION");
        branchPatch = { branchId: branch.id };
      }
    }
    const next = await this.db.updateRegister(id, businessId, {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      ...branchPatch,
    });
    if (!next) throw new Error("NOT_FOUND");
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "register.update",
      entityType: "Register",
      entityId: id,
      requestId,
    });
    return next;
  }

  async openShift(
    businessId: string,
    actorId: string,
    requestId: string,
    registerId: string,
    input: { openingFloatMinor: number },
    role: string,
  ): Promise<DbShift> {
    withScope(businessId, {});
    if (!SHIFT_ROLES.has(role)) throw new Error("FORBIDDEN");
    return this.withLock(`register:${businessId}:${registerId}`, async () => {
      const reg = await this.requireRegister(businessId, registerId);
      if (!reg.isActive) throw new Error("VALIDATION");
      const existing = await this.db.findOpenShiftByRegister(businessId, registerId);
      if (existing) throw new Error("SHIFT_ALREADY_OPEN");
      const shift = await this.db.createShift({
        businessId,
        registerId,
        branchId: reg.branchId ?? null,
        status: "OPEN",
        openedBy: actorId,
        closedBy: null,
        openingFloatMinor: input.openingFloatMinor,
        countedCashMinor: null,
        varianceMinor: null,
        cashSalesMinor: 0,
        cashRefundsMinor: 0,
        cashExpensesMinor: 0,
        cashDepositsMinor: 0,
        cashWithdrawalsMinor: 0,
        adjustmentsMinor: 0,
        expectedCashMinor: 0,
        closeNotes: null,
      });
      if (input.openingFloatMinor > 0) {
        await this.db.createCashMovement({
          businessId,
          shiftId: shift.id,
          registerId,
          branchId: reg.branchId ?? null,
          type: "opening_float",
          amountMinor: input.openingFloatMinor,
          reason: null,
          referenceType: null,
          referenceId: null,
          actorId,
          requestId,
        });
      }
      await this.db.appendAudit({
        businessId,
        actorId,
        action: "shift.open",
        entityType: "Shift",
        entityId: shift.id,
        requestId,
      });
      return shift;
    });
  }

  async recordCash(
    businessId: string,
    actorId: string,
    requestId: string,
    shiftId: string,
    input: { kind: CashKind; amountMinor: number; reason?: string },
    granted: string[],
  ): Promise<DbCashMovement> {
    withScope(businessId, {});
    const shift = await this.requireShift(businessId, shiftId);
    if (shift.status !== "OPEN") throw new Error("SHIFT_CLOSED_IMMUTABLE");
    const type = kindToType(input.kind);
    if (type === "adjustment" && !granted.includes("shift.close.override")) {
      throw new Error("FORBIDDEN");
    }
    if (
      (type === "paid_out" || type === "cash_withdrawal" || type === "adjustment") &&
      (!input.reason || input.reason.trim().length < 3)
    ) {
      throw new Error("VALIDATION");
    }
    const signed = signForCash(type) === 0
      ? input.amountMinor
      : signForCash(type) * Math.abs(input.amountMinor);
    validateCashAmount(type, signed);
    const row = await this.db.createCashMovement({
      businessId,
      shiftId: shift.id,
      registerId: shift.registerId,
      branchId: shift.branchId ?? null,
      type,
      amountMinor: signed,
      reason: input.reason?.trim() ? input.reason.trim() : null,
      referenceType: null,
      referenceId: null,
      actorId,
      requestId,
    });
    await this.db.appendAudit({
      businessId,
      actorId,
      action: type === "adjustment" ? "shift.adjust" : "shift.cash",
      entityType: "Shift",
      entityId: shift.id,
      requestId,
    });
    return row;
  }

  async closeShift(
    businessId: string,
    actorId: string,
    requestId: string,
    shiftId: string,
    input: { countedCashMinor: number; closeNotes?: string },
    granted: string[],
  ): Promise<{ shift: DbShift; report: ShiftReport }> {
    withScope(businessId, {});
    return this.withLock(`shift:${businessId}:${shiftId}`, async () => {
      const shift = await this.requireShift(businessId, shiftId);
      if (shift.status !== "OPEN") throw new Error("SHIFT_ALREADY_CLOSED");
      if (shift.openedBy !== actorId && !granted.includes("shift.close.override")) {
        throw new Error("FORBIDDEN");
      }
      const movements = await this.db.listCashMovementsByShift(shift.id, businessId);
      const sums = sumCashComponents(movements);
      const expectedCash = computeExpectedCash({ openingFloat: shift.openingFloatMinor, ...sums });
      const variance = computeVariance(input.countedCashMinor, expectedCash);
      const updated = await this.db.updateShift(shift.id, businessId, {
        status: "CLOSED",
        closedBy: actorId,
        countedCashMinor: input.countedCashMinor,
        varianceMinor: variance,
        cashSalesMinor: sums.cashSales,
        cashRefundsMinor: sums.cashRefunds,
        cashExpensesMinor: sums.cashExpenses,
        cashDepositsMinor: sums.cashDeposits,
        cashWithdrawalsMinor: sums.cashWithdrawals,
        adjustmentsMinor: sums.adjustments,
        expectedCashMinor: expectedCash,
        closeNotes: input.closeNotes?.trim() ? input.closeNotes.trim() : null,
      });
      if (!updated) throw new Error("NOT_FOUND");
      await this.db.appendAudit({
        businessId,
        actorId,
        action: "shift.close",
        entityType: "Shift",
        entityId: shift.id,
        requestId,
      });
      const report: ShiftReport = {
        shiftId: updated.id,
        status: updated.status,
        branchId: updated.branchId ?? null,
        components: {
          openingFloat: updated.openingFloatMinor,
          cashSales: sums.cashSales,
          cashRefunds: sums.cashRefunds,
          cashExpenses: sums.cashExpenses,
          cashDeposits: sums.cashDeposits,
          cashWithdrawals: sums.cashWithdrawals,
          adjustments: sums.adjustments,
          expectedCash,
          countedCash: input.countedCashMinor,
          variance,
        },
        movements,
        expectedCash,
        variance,
      };
      return { shift: updated, report };
    });
  }

  async getShift(
    businessId: string,
    shiftId: string,
    role: string,
    actorId: string,
  ): Promise<{
    shift: DbShift;
    components: ShiftComponents;
    movements: DbCashMovement[];
    corrections: DbShiftCorrection[];
    correctedExpectedCash: number | null;
  }> {
    withScope(businessId, {});
    const shift = await this.requireShift(businessId, shiftId);
    if (role === "cashier" && shift.openedBy !== actorId) throw new Error("FORBIDDEN");
    const components = await this.componentsFor(shift);
    const movements = await this.db.listCashMovementsByShift(shift.id, businessId);
    if (shift.status === "CLOSED") {
      const drift =
        components.cashSales !== shift.cashSalesMinor ||
        components.cashRefunds !== shift.cashRefundsMinor ||
        components.cashExpenses !== shift.cashExpensesMinor ||
        components.cashDeposits !== shift.cashDepositsMinor ||
        components.cashWithdrawals !== shift.cashWithdrawalsMinor ||
        components.adjustments !== shift.adjustmentsMinor ||
        components.expectedCash !== shift.expectedCashMinor;
      if (drift) throw new Error("INTERNAL");
    }
    // Phase 11 (FR-CASH-04): a closed shift is immutable, but its recorded
    // variance can be explained by audited corrections that adjust the
    // expected figure without touching the original record.
    const corrections = await this.db.listShiftCorrections(businessId, shiftId);
    const correctedExpectedCash = corrections.length
      ? components.expectedCash + corrections.reduce((sum, c) => sum + c.amountMinor, 0)
      : null;
    return { shift, components, movements, corrections, correctedExpectedCash };
  }

  // FR-CASH-04: corrections use an audited adjustment workflow. Only closed
  // shifts are correctable (open shifts take live cash movements), the shift
  // record itself is never mutated.
  async addCorrection(
    businessId: string,
    actorId: string,
    requestId: string,
    granted: string[],
    shiftId: string,
    input: { amountMinor: number; reason: string },
  ): Promise<DbShiftCorrection> {
    withScope(businessId, {});
    if (!granted.includes("shift.close.override")) throw new Error("FORBIDDEN");
    if (!Number.isInteger(input.amountMinor) || input.amountMinor === 0) throw new Error("VALIDATION");
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 200) throw new Error("VALIDATION");
    const shift = await this.requireShift(businessId, shiftId);
    if (shift.status !== "CLOSED") throw new Error("VALIDATION");
    const correction = await this.db.createShiftCorrection({
      businessId,
      shiftId,
      amountMinor: input.amountMinor,
      reason,
      actorId,
      requestId,
    });
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "shift.corrected",
      entityType: "Shift",
      entityId: shiftId,
      requestId,
      reason,
    });
    return correction;
  }

  async listShifts(
    businessId: string,
    opts: { cursor?: string; limit?: number; status?: string; registerId?: string },
    role: string,
    actorId: string,
  ): Promise<{ items: DbShift[]; nextCursor: string | null }> {
    withScope(businessId, {});
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    let rows = await this.db.listShiftsByBusiness(businessId);
    if (opts.status) rows = rows.filter((s) => s.status === opts.status);
    if (opts.registerId) rows = rows.filter((s) => s.registerId === opts.registerId);
    if (role === "cashier") rows = rows.filter((s) => s.openedBy === actorId);
    rows = [...rows].sort((a, b) => (a.id < b.id ? 1 : -1));
    let start = 0;
    if (opts.cursor) {
      const idx = rows.findIndex((s) => s.id === opts.cursor);
      start = idx === -1 ? 0 : idx + 1;
    }
    const items = rows.slice(start, start + limit);
    const nextCursor = start + limit < rows.length ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  async postCashSale(
    businessId: string,
    actorId: string,
    requestId: string,
    registerId: string,
    saleId: string,
    cashMinor: number,
    opts?: { type?: "cash_sale" | "cash_refund"; referenceType?: string; referenceId?: string },
  ): Promise<DbCashMovement> {
    withScope(businessId, {});
    const shift = await this.db.findOpenShiftByRegister(businessId, registerId);
    if (!shift) throw new Error("SHIFT_NO_OPEN_SHIFT");
    const type = opts?.type ?? "cash_sale";
    validateCashAmount(type, type === "cash_refund" ? -Math.abs(cashMinor) : cashMinor);
    // No audit row of its own: covered by the sale's sale.complete / refund.approve audit.
    return this.db.createCashMovement({
      businessId,
      shiftId: shift.id,
      registerId,
      branchId: shift.branchId ?? null,
      type,
      amountMinor: type === "cash_refund" ? -Math.abs(cashMinor) : cashMinor,
      reason: null,
      referenceType: opts?.referenceType ?? "Sale",
      referenceId: opts?.referenceId ?? saleId,
      actorId,
      requestId,
    });
  }
}
