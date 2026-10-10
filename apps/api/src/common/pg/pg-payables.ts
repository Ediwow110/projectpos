import type { DbSupplierBill, DbSupplierBillAllocation, DbSupplierCredit, DbSupplierPayment, DbSupplierReturnReceiptAllocation } from "../db.port";
import { nid, type PgContext } from "./context";

function minor(value: unknown): number {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0) throw new Error("ACCOUNTING_INVALID_AMOUNT");
  return out;
}
function bill(row: Record<string, unknown>): DbSupplierBill {
  return { ...row, invoiceAmountMinor: minor(row["invoiceAmountMinor"]), nonStockChargeMinor: minor(row["nonStockChargeMinor"]), paidMinor: minor(row["paidMinor"]) } as DbSupplierBill;
}
function allocation(row: Record<string, unknown>): DbSupplierBillAllocation {
  return { ...row, quantity: Number(row["quantity"]), unitInvoiceCostMinor: minor(row["unitInvoiceCostMinor"]), invoiceAmountMinor: minor(row["invoiceAmountMinor"]), receiptCostMinorSnapshot: minor(row["receiptCostMinorSnapshot"]) } as DbSupplierBillAllocation;
}
function credit(row: Record<string, unknown>): DbSupplierCredit { return { ...row, amountMinor: minor(row["amountMinor"]) } as DbSupplierCredit; }
function payment(row: Record<string, unknown>): DbSupplierPayment { return { ...row, amountMinor: minor(row["amountMinor"]) } as DbSupplierPayment; }
function returnAllocation(row: Record<string, unknown>): DbSupplierReturnReceiptAllocation { return { ...row, quantity: Number(row["quantity"]), unitCostMinorSnapshot: minor(row["unitCostMinorSnapshot"]), billedQuantity: Number(row["billedQuantity"]), billedInvoiceCostMinorSnapshot: minor(row["billedInvoiceCostMinorSnapshot"]) } as DbSupplierReturnReceiptAllocation; }

export function payablesFamily(ctx: PgContext) {
  return {
    async createSupplierBill(input: Omit<DbSupplierBill, "id" | "createdAt" | "updatedAt">): Promise<DbSupplierBill> {
      const client = await ctx.client();
      try {
        const result = await client.query('INSERT INTO "SupplierBill" ("id","businessId","supplierId","branchId","invoiceNumber","invoiceDate","dueDate","currency","status","invoiceAmountMinor","nonStockChargeMinor","paidMinor","version","notes","createdBy","postedBy","postedAt","voidedBy","voidedAt","requestId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,CURRENT_TIMESTAMP) RETURNING *', [nid("bill"), input.businessId, input.supplierId, input.branchId, input.invoiceNumber, input.invoiceDate, input.dueDate, input.currency, input.status, input.invoiceAmountMinor, input.nonStockChargeMinor, input.paidMinor, input.version, input.notes, input.createdBy, input.postedBy, input.postedAt, input.voidedBy, input.voidedAt, input.requestId]);
        return bill(result.rows[0] as Record<string, unknown>);
      } catch (error) { if ((error as { code?: string }).code === "23505") throw new Error("CONFLICT"); throw error; }
      finally { if (ctx.owns()) client.release(); }
    },
    async findSupplierBill(id: string, businessId: string): Promise<DbSupplierBill | null> {
      const client = await ctx.client(); try { const r = await client.query('SELECT * FROM "SupplierBill" WHERE "id"=$1 AND "businessId"=$2', [id, businessId]); return r.rows[0] ? bill(r.rows[0] as Record<string, unknown>) : null; } finally { if (ctx.owns()) client.release(); }
    },
    async listSupplierBills(businessId: string): Promise<DbSupplierBill[]> {
      const client = await ctx.client(); try { const r = await client.query('SELECT * FROM "SupplierBill" WHERE "businessId"=$1 ORDER BY "createdAt" DESC,"id" DESC LIMIT 500', [businessId]); return r.rows.map((row) => bill(row as Record<string, unknown>)); } finally { if (ctx.owns()) client.release(); }
    },
    async listSupplierBillsPage(businessId: string, afterId: string | null, limit: number): Promise<DbSupplierBill[]> {
      const client = await ctx.client(); try { const r = await client.query(`SELECT * FROM "SupplierBill" WHERE "businessId"=$1 AND ($2::text IS NULL OR "id">$2) ORDER BY "id" LIMIT $3`, [businessId, afterId, limit]); return r.rows.map((row) => bill(row as Record<string, unknown>)); } finally { if (ctx.owns()) client.release(); }
    },
    async updateSupplierBill(id: string, businessId: string, patch: Partial<Omit<DbSupplierBill, "id" | "businessId" | "createdAt" | "version">>, expectedVersion: number): Promise<DbSupplierBill | null> {
      const client = await ctx.client();
      try {
        const allowed = new Set(["branchId","invoiceNumber","invoiceDate","dueDate","currency","status","invoiceAmountMinor","nonStockChargeMinor","paidMinor","notes","postedBy","postedAt","voidedBy","voidedAt","requestId"]);
        const fields = Object.entries(patch).filter(([key]) => allowed.has(key));
        const params: unknown[] = [id, businessId, expectedVersion];
        const sets = fields.map(([key, value]) => { params.push(value); return `"${key}"=$${params.length}`; });
        params.push(new Date());
        sets.push(`"updatedAt"=$${params.length}`, '"version"="version"+1');
        const r = await client.query(`UPDATE "SupplierBill" SET ${sets.join(",")} WHERE "id"=$1 AND "businessId"=$2 AND "version"=$3 RETURNING *`, params);
        return r.rows[0] ? bill(r.rows[0] as Record<string, unknown>) : null;
      } finally { if (ctx.owns()) client.release(); }
    },
    async createSupplierBillAllocation(input: Omit<DbSupplierBillAllocation, "id">): Promise<DbSupplierBillAllocation> {
      const client = await ctx.client();
      try { const r = await client.query('INSERT INTO "SupplierBillAllocation" ("id","businessId","billId","receiptLineId","quantity","unitInvoiceCostMinor","invoiceAmountMinor","receiptCostMinorSnapshot") VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [nid("billalloc"), input.businessId, input.billId, input.receiptLineId, input.quantity, input.unitInvoiceCostMinor, input.invoiceAmountMinor, input.receiptCostMinorSnapshot]); return allocation(r.rows[0] as Record<string, unknown>); }
      catch (error) { if ((error as { code?: string }).code === "23505") throw new Error("CONFLICT"); throw error; } finally { if (ctx.owns()) client.release(); }
    },
    async listSupplierBillAllocations(billId: string, businessId: string): Promise<DbSupplierBillAllocation[]> {
      const client = await ctx.client(); try { const r = await client.query('SELECT * FROM "SupplierBillAllocation" WHERE "billId"=$1 AND "businessId"=$2 ORDER BY "id"', [billId, businessId]); return r.rows.map((row) => allocation(row as Record<string, unknown>)); } finally { if (ctx.owns()) client.release(); }
    },
    async billedQuantityByReceiptLine(businessId: string, receiptLineId: string): Promise<number> {
      const client = await ctx.client(); try { const r = await client.query('SELECT COALESCE(SUM(a."quantity"),0)::int AS "quantity" FROM "SupplierBillAllocation" a JOIN "SupplierBill" b ON b."id"=a."billId" AND b."businessId"=a."businessId" WHERE a."businessId"=$1 AND a."receiptLineId"=$2 AND b."status" IN (\'POSTED\',\'PARTIALLY_PAID\',\'PAID\')', [businessId, receiptLineId]); return Number(r.rows[0]?.["quantity"] ?? 0); } finally { if (ctx.owns()) client.release(); }
    },
    async createSupplierCredit(input: Omit<DbSupplierCredit, "id" | "createdAt">): Promise<DbSupplierCredit> {
      const client = await ctx.client(); try { const r = await client.query('INSERT INTO "SupplierCredit" ("id","businessId","supplierId","billId","supplierReturnId","creditNumber","amountMinor","status","createdBy","requestId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *', [nid("credit"), input.businessId, input.supplierId, input.billId, input.supplierReturnId, input.creditNumber, input.amountMinor, input.status, input.createdBy, input.requestId]); return credit(r.rows[0] as Record<string, unknown>); }
      catch (error) { if ((error as { code?: string }).code === "23505") throw new Error("CONFLICT"); throw error; } finally { if (ctx.owns()) client.release(); }
    },
    async updateSupplierCredit(id: string, businessId: string, patch: Pick<DbSupplierCredit, "billId" | "status">): Promise<DbSupplierCredit | null> {
      const client = await ctx.client(); try { const r = await client.query('UPDATE "SupplierCredit" SET "billId"=$3,"status"=$4 WHERE "id"=$1 AND "businessId"=$2 RETURNING *', [id, businessId, patch.billId, patch.status]); return r.rows[0] ? credit(r.rows[0] as Record<string, unknown>) : null; } finally { if (ctx.owns()) client.release(); }
    },
    async listSupplierCredits(businessId: string, supplierId: string): Promise<DbSupplierCredit[]> {
      const client = await ctx.client(); try { const r = await client.query('SELECT * FROM "SupplierCredit" WHERE "businessId"=$1 AND "supplierId"=$2 ORDER BY "createdAt"', [businessId, supplierId]); return r.rows.map((row) => credit(row as Record<string, unknown>)); } finally { if (ctx.owns()) client.release(); }
    },
    async listUnappliedSupplierCredits(businessId: string): Promise<DbSupplierCredit[]> {
      const client = await ctx.client(); try { const r = await client.query('SELECT * FROM "SupplierCredit" WHERE "businessId"=$1 AND "billId" IS NULL AND "status"=\'POSTED\' ORDER BY "createdAt","id"', [businessId]); return r.rows.map((row) => credit(row as Record<string, unknown>)); } finally { if (ctx.owns()) client.release(); }
    },
    async createSupplierPayment(input: Omit<DbSupplierPayment, "id" | "createdAt">): Promise<DbSupplierPayment> {
      const client = await ctx.client(); try { const r = await client.query('INSERT INTO "SupplierPayment" ("id","businessId","supplierId","billId","branchId","amountMinor","method","paidFromAccountId","reference","paidAt","shiftId","cashMovementId","idempotencyKey","createdBy","requestId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *', [nid("payment"), input.businessId, input.supplierId, input.billId, input.branchId, input.amountMinor, input.method, input.paidFromAccountId, input.reference, input.paidAt, input.shiftId, input.cashMovementId, input.idempotencyKey, input.createdBy, input.requestId]); return payment(r.rows[0] as Record<string, unknown>); }
      catch (error) { if ((error as { code?: string }).code === "23505") throw new Error("CONFLICT"); throw error; } finally { if (ctx.owns()) client.release(); }
    },
    async listSupplierPayments(billId: string, businessId: string): Promise<DbSupplierPayment[]> {
      const client = await ctx.client(); try { const r = await client.query('SELECT * FROM "SupplierPayment" WHERE "billId"=$1 AND "businessId"=$2 ORDER BY "paidAt","id"', [billId, businessId]); return r.rows.map((row) => payment(row as Record<string, unknown>)); } finally { if (ctx.owns()) client.release(); }
    },
    async updateSupplierPayment(id: string, businessId: string, patch: Partial<Pick<DbSupplierPayment, "cashMovementId">>): Promise<DbSupplierPayment | null> {
      const client = await ctx.client(); try { const r = await client.query('UPDATE "SupplierPayment" SET "cashMovementId"=$3 WHERE "id"=$1 AND "businessId"=$2 RETURNING *', [id, businessId, patch.cashMovementId ?? null]); return r.rows[0] ? payment(r.rows[0] as Record<string, unknown>) : null; } finally { if (ctx.owns()) client.release(); }
    },
    async createSupplierReturnReceiptAllocation(input: Omit<DbSupplierReturnReceiptAllocation, "id">): Promise<DbSupplierReturnReceiptAllocation> {
      const client = await ctx.client(); try { const r = await client.query('INSERT INTO "SupplierReturnReceiptAllocation" ("id","businessId","supplierReturnLineId","receiptLineId","quantity","unitCostMinorSnapshot","billedQuantity","billedInvoiceCostMinorSnapshot") VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [nid("retalloc"), input.businessId, input.supplierReturnLineId, input.receiptLineId, input.quantity, input.unitCostMinorSnapshot, input.billedQuantity, input.billedInvoiceCostMinorSnapshot]); return returnAllocation(r.rows[0] as Record<string, unknown>); }
      catch (error) { if ((error as { code?: string }).code === "23505") throw new Error("CONFLICT"); throw error; } finally { if (ctx.owns()) client.release(); }
    },
    async listSupplierReturnReceiptAllocations(returnLineId: string, businessId: string): Promise<DbSupplierReturnReceiptAllocation[]> {
      const client = await ctx.client(); try { const r = await client.query('SELECT * FROM "SupplierReturnReceiptAllocation" WHERE "supplierReturnLineId"=$1 AND "businessId"=$2 ORDER BY "id"', [returnLineId, businessId]); return r.rows.map((row) => returnAllocation(row as Record<string, unknown>)); } finally { if (ctx.owns()) client.release(); }
    },
    async returnedQuantityByReceiptLine(businessId: string, receiptLineId: string): Promise<number> {
      const client = await ctx.client(); try { const r = await client.query('SELECT COALESCE(SUM(a."quantity"),0)::int AS "quantity" FROM "SupplierReturnReceiptAllocation" a JOIN "SupplierReturnLine" rl ON rl."id"=a."supplierReturnLineId" AND rl."businessId"=a."businessId" JOIN "SupplierReturn" sr ON sr."id"=rl."supplierReturnId" AND sr."businessId"=a."businessId" WHERE a."businessId"=$1 AND a."receiptLineId"=$2 AND sr."status"=\'POSTED\'', [businessId, receiptLineId]); return Number(r.rows[0]?.["quantity"] ?? 0); } finally { if (ctx.owns()) client.release(); }
    },
    async returnedBilledQuantityByReceiptLine(businessId: string, receiptLineId: string): Promise<number> {
      const client = await ctx.client(); try { const r = await client.query('SELECT COALESCE(SUM(a."billedQuantity"),0)::int AS "quantity" FROM "SupplierReturnReceiptAllocation" a JOIN "SupplierReturnLine" rl ON rl."id"=a."supplierReturnLineId" AND rl."businessId"=a."businessId" JOIN "SupplierReturn" sr ON sr."id"=rl."supplierReturnId" AND sr."businessId"=a."businessId" WHERE a."businessId"=$1 AND a."receiptLineId"=$2 AND sr."status"=\'POSTED\'', [businessId, receiptLineId]); return Number(r.rows[0]?.["quantity"] ?? 0); } finally { if (ctx.owns()) client.release(); }
    },
  };
}
