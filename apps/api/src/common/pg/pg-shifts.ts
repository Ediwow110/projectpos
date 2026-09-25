import type { DbCashMovement, DbRegister, DbShift } from "../db.port";
import { nid } from "./context";
import type { PgContext } from "./context";

// The shifts family: registers, shifts and their cash movements. Mapping notes:
// - Shift has no createdAt/updatedAt columns in the DDL; openedAt is its
//   creation timestamp, so insertion order is `ORDER BY "openedAt" ASC, "id" ASC`
//   and updateShift touches only the patched columns.
// - Shift.closedAt has no port counterpart (DbShift omits it), so nothing at
//   the port level ever writes it — the memory store has no such field either.
// - findOpenShiftByRegister mirrors memory's first-match scan in insertion
//   order (the oldest OPEN shift; the service guarantees at most one).
// - CashMovement.amountMinor is signed and the DDL checks it is non-zero.
export function shiftsFamily(ctx: PgContext) {
  const REGISTER_COLUMNS =
    '"id", "businessId", "name", "isActive", "branchId"';
  const SHIFT_COLUMNS =
    '"id", "businessId", "registerId", "branchId", "status", "openedBy", "closedBy",' +
    ' "openingFloatMinor", "countedCashMinor", "varianceMinor", "cashSalesMinor", "cashRefundsMinor",' +
    ' "cashExpensesMinor", "cashDepositsMinor", "cashWithdrawalsMinor", "adjustmentsMinor",' +
    ' "expectedCashMinor", "closeNotes"';
  const MOVEMENT_COLUMNS =
    '"id", "businessId", "shiftId", "registerId", "branchId", "type", "amountMinor", "reason",' +
    ' "referenceType", "referenceId", "actorId", "requestId"';

  // The patch keys are TypeScript-checked against the Db port type, whose
  // property names are exactly the DDL column names, so quoting them from
  // them is safe. Keys explicitly set to undefined are skipped — the SQL NOT NULL
  // columns could not take them, and no caller produces them.
  function buildSet(patch: Record<string, unknown>): { sets: string[]; values: unknown[] } {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      values.push(value);
      sets.push(`"${key}" = $${values.length}`);
    }
    return { sets, values };
  }

  return {
    async createRegister(r: Omit<DbRegister, "id">): Promise<DbRegister> {
      const c = await ctx.client();
      try {
        const row = { ...r, id: nid("reg") };
        await c.query(
          'INSERT INTO "Register" ("id", "businessId", "name", "isActive", "branchId", "createdAt", "updatedAt")' +
            ' VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
          [row.id, row.businessId, row.name, row.isActive, row.branchId ?? null],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listRegisters(businessId: string): Promise<DbRegister[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${REGISTER_COLUMNS} FROM "Register" WHERE "businessId" = $1 ORDER BY "createdAt" ASC, "id" ASC`,
          [businessId],
        );
        return r.rows as DbRegister[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findRegisterById(id: string, businessId: string): Promise<DbRegister | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${REGISTER_COLUMNS} FROM "Register" WHERE "id" = $1 AND "businessId" = $2`,
          [id, businessId],
        );
        return (r.rows[0] as DbRegister | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async updateRegister(
      id: string,
      businessId: string,
      patch: Partial<Omit<DbRegister, "id" | "businessId">>,
    ): Promise<DbRegister | null> {
      const c = await ctx.client();
      try {
        const { sets, values } = buildSet(patch);
        const r = await c.query(
          `UPDATE "Register" SET ${sets.length ? sets.join(", ") + ", " : ""}"updatedAt" = CURRENT_TIMESTAMP` +
            ` WHERE "id" = $${values.length + 1} AND "businessId" = $${values.length + 2}` +
            ` RETURNING ${REGISTER_COLUMNS}`,
          [...values, id, businessId],
        );
        return (r.rows[0] as DbRegister | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createShift(s: Omit<DbShift, "id">): Promise<DbShift> {
      const c = await ctx.client();
      try {
        const row = { ...s, id: nid("shift") };
        // closedAt is not part of the port shape; it stays NULL like memory.
        await c.query(
          'INSERT INTO "Shift" ("id", "businessId", "registerId", "branchId", "status", "openedBy", "closedBy",' +
            ' "openingFloatMinor", "countedCashMinor", "varianceMinor", "cashSalesMinor", "cashRefundsMinor",' +
            ' "cashExpensesMinor", "cashDepositsMinor", "cashWithdrawalsMinor", "adjustmentsMinor",' +
            ' "expectedCashMinor", "closeNotes", "openedAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, CURRENT_TIMESTAMP)',
          [
            row.id, row.businessId, row.registerId, row.branchId ?? null, row.status, row.openedBy,
            row.closedBy, row.openingFloatMinor, row.countedCashMinor, row.varianceMinor,
            row.cashSalesMinor, row.cashRefundsMinor, row.cashExpensesMinor, row.cashDepositsMinor,
            row.cashWithdrawalsMinor, row.adjustmentsMinor, row.expectedCashMinor, row.closeNotes,
          ],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findShiftById(id: string, businessId: string): Promise<DbShift | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${SHIFT_COLUMNS} FROM "Shift" WHERE "id" = $1 AND "businessId" = $2`,
          [id, businessId],
        );
        return (r.rows[0] as DbShift | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findOpenShiftByRegister(businessId: string, registerId: string): Promise<DbShift | null> {
      const c = await ctx.client();
      try {
        // Oldest OPEN shift in insertion order — memory's first-match scan.
        const r = await c.query(
          `SELECT ${SHIFT_COLUMNS} FROM "Shift" WHERE "businessId" = $1 AND "registerId" = $2 AND "status" = 'OPEN'` +
            ' ORDER BY "openedAt" ASC, "id" ASC LIMIT 1',
          [businessId, registerId],
        );
        return (r.rows[0] as DbShift | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listShiftsByBusiness(businessId: string): Promise<DbShift[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${SHIFT_COLUMNS} FROM "Shift" WHERE "businessId" = $1 ORDER BY "openedAt" ASC, "id" ASC`,
          [businessId],
        );
        return r.rows as DbShift[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async updateShift(
      id: string,
      businessId: string,
      patch: Partial<Omit<DbShift, "id" | "businessId">>,
    ): Promise<DbShift | null> {
      const c = await ctx.client();
      try {
        const { sets, values } = buildSet(patch);
        // Shift has no updatedAt column; an empty patch just re-reads the row,
        // mirroring memory's "merge nothing, return current" behavior.
        if (!sets.length) {
          const r = await c.query(
            `SELECT ${SHIFT_COLUMNS} FROM "Shift" WHERE "id" = $1 AND "businessId" = $2`,
            [id, businessId],
          );
          return (r.rows[0] as DbShift | undefined) ?? null;
        }
        const r = await c.query(
          `UPDATE "Shift" SET ${sets.join(", ")}` +
            ` WHERE "id" = $${values.length + 1} AND "businessId" = $${values.length + 2}` +
            ` RETURNING ${SHIFT_COLUMNS}`,
          [...values, id, businessId],
        );
        return (r.rows[0] as DbShift | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createCashMovement(m: Omit<DbCashMovement, "id">): Promise<DbCashMovement> {
      const c = await ctx.client();
      try {
        const row = { ...m, id: nid("cmov") };
        await c.query(
          'INSERT INTO "CashMovement" ("id", "businessId", "shiftId", "registerId", "branchId", "type", "amountMinor", "reason", "referenceType", "referenceId", "actorId", "requestId", "createdAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)',
          [
            row.id, row.businessId, row.shiftId, row.registerId, row.branchId ?? null, row.type,
            row.amountMinor, row.reason, row.referenceType, row.referenceId, row.actorId, row.requestId,
          ],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listCashMovementsByShift(shiftId: string, businessId: string): Promise<DbCashMovement[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${MOVEMENT_COLUMNS} FROM "CashMovement" WHERE "shiftId" = $1 AND "businessId" = $2` +
            ' ORDER BY "createdAt" ASC, "id" ASC',
          [shiftId, businessId],
        );
        return r.rows as DbCashMovement[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async hasShiftForRegister(businessId: string, registerId: string): Promise<boolean> {
      const c = await ctx.client();
      try {
        // Any shift regardless of status — exactly the memory filter.
        const r = await c.query(
          'SELECT 1 FROM "Shift" WHERE "businessId" = $1 AND "registerId" = $2 LIMIT 1',
          [businessId, registerId],
        );
        return (r.rowCount ?? 0) > 0;
      } finally {
        if (ctx.owns()) c.release();
      }
    },
  };
}

export type ShiftsFamily = ReturnType<typeof shiftsFamily>;
