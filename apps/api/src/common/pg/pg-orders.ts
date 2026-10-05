import type {
  DbFulfillment,
  DbFulfillmentLine,
  DbInventoryReservation,
  DbOrder,
  DbOrderAccessToken,
  DbOrderAccessTokenKind,
  DbOrderLine,
  DbOrderPageQuery,
} from "../db.port";
import { nid } from "./context";
import type { PgContext } from "./context";

const ORDER_SELECT =
  '"id", "businessId", "channel", "fulfillmentMode", "paymentMode", "branchId", "customerId", "contactName", "email", "phone", ' +
  '"deliveryAddress", "fulfillmentInstructions", "currency", "subtotalMinor", "discountMinor", "taxMinor", "deliveryFeeMinor", ' +
  '"deliveryTaxMinor", "totalMinor", "saleId", "status", "version", "checkoutAt", "submittedAt", "confirmedAt", "completedAt", ' +
  '"cancelledAt", "actorId", "requestId", "createdAt", "updatedAt"';
const ORDER_LINE_SELECT =
  '"id", "businessId", "orderId", "position", "productId", "name", "sku", "barcode", "unit", "qty", "priceMinor", "costMinor", ' +
  '"taxRateBps", "discountMinor", "taxMinor", "lineTotalMinor", "bundleComponentsSnapshot", "createdAt"';
const RESERVATION_SELECT =
  '"id", "businessId", "branchId", "orderId", "orderLineId", "productId", "qty", "status", "expiresAt", "idempotencyKey", "createdAt", "updatedAt"';
const FULFILLMENT_SELECT =
  '"id", "businessId", "orderId", "type", "status", "branchId", "assignedUserId", "contactName", "email", "phone", "deliveryAddress", ' +
  '"instructions", "version", "readyAt", "dispatchedAt", "deliveredAt", "collectedAt", "failedAt", "cancelledAt", "createdAt", "updatedAt"';
const FULFILLMENT_LINE_SELECT =
  '"id", "businessId", "fulfillmentId", "orderLineId", "qty", "createdAt"';
const ACCESS_TOKEN_SELECT =
  '"id", "businessId", "orderId", "kind", "tokenHash", "expiresAt", "revokedAt", "createdAt"';
const PAYMENT_STATUS_SQL = [
  "CASE",
  "WHEN \"Order\".\"saleId\" IS NULL THEN 'UNPAID'",
  "WHEN (SELECT s.\"status\" FROM \"Sale\" s WHERE s.\"id\" = \"Order\".\"saleId\" AND s.\"businessId\" = \"Order\".\"businessId\") = 'REFUNDED' THEN 'REFUNDED'",
  "WHEN COALESCE((SELECT SUM(r.\"totalMinor\") FROM \"Refund\" r WHERE r.\"saleId\" = \"Order\".\"saleId\" AND r.\"businessId\" = \"Order\".\"businessId\" AND r.\"status\" = 'APPROVED'), 0) >= COALESCE((SELECT s.\"totalMinor\" FROM \"Sale\" s WHERE s.\"id\" = \"Order\".\"saleId\" AND s.\"businessId\" = \"Order\".\"businessId\"), 1) AND COALESCE((SELECT s.\"totalMinor\" FROM \"Sale\" s WHERE s.\"id\" = \"Order\".\"saleId\" AND s.\"businessId\" = \"Order\".\"businessId\"), 0) > 0 THEN 'REFUNDED'",
  "WHEN (SELECT s.\"status\" FROM \"Sale\" s WHERE s.\"id\" = \"Order\".\"saleId\" AND s.\"businessId\" = \"Order\".\"businessId\") = 'PARTIALLY_REFUNDED' OR EXISTS (SELECT 1 FROM \"Refund\" r WHERE r.\"saleId\" = \"Order\".\"saleId\" AND r.\"businessId\" = \"Order\".\"businessId\" AND r.\"status\" = 'APPROVED' AND r.\"totalMinor\" > 0) THEN 'PARTIALLY_REFUNDED'",
  "WHEN EXISTS (SELECT 1 FROM \"Payment\" p WHERE p.\"saleId\" = \"Order\".\"saleId\" AND p.\"businessId\" = \"Order\".\"businessId\" AND p.\"status\" = 'UNKNOWN') THEN 'UNKNOWN'",
  "WHEN COALESCE((SELECT SUM(p.\"amountMinor\") FROM \"Payment\" p WHERE p.\"saleId\" = \"Order\".\"saleId\" AND p.\"businessId\" = \"Order\".\"businessId\" AND p.\"status\" = 'SUCCEEDED'), 0) >= COALESCE((SELECT s.\"totalMinor\" FROM \"Sale\" s WHERE s.\"id\" = \"Order\".\"saleId\" AND s.\"businessId\" = \"Order\".\"businessId\"), 1) AND COALESCE((SELECT s.\"totalMinor\" FROM \"Sale\" s WHERE s.\"id\" = \"Order\".\"saleId\" AND s.\"businessId\" = \"Order\".\"businessId\"), 0) > 0 THEN 'PAID'",
  "WHEN (SELECT s.\"status\" FROM \"Sale\" s WHERE s.\"id\" = \"Order\".\"saleId\" AND s.\"businessId\" = \"Order\".\"businessId\") = 'PENDING_PAYMENT' THEN 'PENDING'",
  "WHEN (SELECT s.\"status\" FROM \"Sale\" s WHERE s.\"id\" = \"Order\".\"saleId\" AND s.\"businessId\" = \"Order\".\"businessId\") = 'PAYMENT_FAILED' THEN 'FAILED'",
  "WHEN (SELECT s.\"status\" FROM \"Sale\" s WHERE s.\"id\" = \"Order\".\"saleId\" AND s.\"businessId\" = \"Order\".\"businessId\") = 'PAYMENT_UNKNOWN' THEN 'UNKNOWN'",
  "WHEN (SELECT s.\"status\" FROM \"Sale\" s WHERE s.\"id\" = \"Order\".\"saleId\" AND s.\"businessId\" = \"Order\".\"businessId\") = 'RECONCILED' THEN CASE WHEN EXISTS (SELECT 1 FROM \"Payment\" p WHERE p.\"saleId\" = \"Order\".\"saleId\" AND p.\"businessId\" = \"Order\".\"businessId\" AND p.\"status\" = 'FAILED') THEN 'FAILED' ELSE 'PENDING' END",
  "WHEN (SELECT s.\"status\" FROM \"Sale\" s WHERE s.\"id\" = \"Order\".\"saleId\" AND s.\"businessId\" = \"Order\".\"businessId\") IN ('PAID','COMPLETED','REFUND_REQUESTED') THEN 'PAID'",
  "ELSE 'UNPAID'",
  "END",
].join(" ");

function buildSet(patch: Record<string, unknown>): { sets: string[]; values: unknown[] } {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    values.push(value);
    sets.push('"' + key + '" = $' + values.length);
  }
  return { sets, values };
}

export function ordersFamily(ctx: PgContext) {
  return {
    async createOrder(o: Omit<DbOrder, "id">): Promise<DbOrder> {
      const c = await ctx.client();
      try {
        const row: DbOrder = { ...o, id: nid("ord") };
        await c.query(
          'INSERT INTO "Order" ("id", "businessId", "channel", "fulfillmentMode", "paymentMode", "branchId", "customerId", "contactName", "email", "phone", "deliveryAddress", "fulfillmentInstructions", "currency", "subtotalMinor", "discountMinor", "taxMinor", "deliveryFeeMinor", "deliveryTaxMinor", "totalMinor", "saleId", "status", "version", "checkoutAt", "submittedAt", "confirmedAt", "completedAt", "cancelledAt", "actorId", "requestId", "createdAt", "updatedAt")' +
            ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)',
          [
            row.id, row.businessId, row.channel, row.fulfillmentMode, row.paymentMode, row.branchId,
            row.customerId, row.contactName, row.email, row.phone,
            row.deliveryAddress === null ? null : JSON.stringify(row.deliveryAddress), row.fulfillmentInstructions,
            row.currency, row.subtotalMinor, row.discountMinor, row.taxMinor, row.deliveryFeeMinor, row.deliveryTaxMinor,
            row.totalMinor, row.saleId, row.status, row.version, row.checkoutAt, row.submittedAt, row.confirmedAt,
            row.completedAt, row.cancelledAt, row.actorId, row.requestId, row.createdAt, row.updatedAt,
          ],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },
    async findOrderById(id: string, businessId: string): Promise<DbOrder | null> {
      const c = await ctx.client();
      try {
        const r = await c.query('SELECT ' + ORDER_SELECT + ' FROM "Order" WHERE "id" = $1 AND "businessId" = $2', [id, businessId]);
        return (r.rows[0] as DbOrder | undefined) ?? null;
      } finally { if (ctx.owns()) c.release(); }
    },
    async findOrderBySaleId(saleId: string, businessId: string): Promise<DbOrder | null> {
      const c = await ctx.client();
      try {
        const r = await c.query('SELECT ' + ORDER_SELECT + ' FROM "Order" WHERE "saleId" = $1 AND "businessId" = $2', [saleId, businessId]);
        return (r.rows[0] as DbOrder | undefined) ?? null;
      } finally { if (ctx.owns()) c.release(); }
    },
    async updateOrder(
      id: string,
      businessId: string,
      patch: Partial<Omit<DbOrder, "id" | "businessId" | "version">>,
      expectedVersion: number,
    ): Promise<DbOrder | null> {
      const c = await ctx.client();
      try {
        const { sets, values } = buildSet(patch);
        const r = await c.query(
          'UPDATE "Order" SET ' + (sets.length ? sets.join(", ") + ", " : "") +
            '"version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP' +
            ' WHERE "id" = $' + (values.length + 1) + ' AND "businessId" = $' + (values.length + 2) +
            ' AND "version" = $' + (values.length + 3) + ' RETURNING ' + ORDER_SELECT,
          [...values, id, businessId, expectedVersion],
        );
        return (r.rows[0] as DbOrder | undefined) ?? null;
      } finally { if (ctx.owns()) c.release(); }
    },
    async listOrdersPage(businessId: string, query: DbOrderPageQuery): Promise<DbOrder[]> {
      const c = await ctx.client();
      try {
        const where = ['"businessId" = $1'];
        const values: unknown[] = [businessId];
        const add = (column: string, op: string, value: unknown) => {
          values.push(value);
          where.push('"' + column + '" ' + op + ' $' + values.length);
        };
        if (query.status) add("status", "=", query.status);
        if (query.channel) add("channel", "=", query.channel);
        if (query.fulfillmentMode) add("fulfillmentMode", "=", query.fulfillmentMode);
        if (query.branchId) add("branchId", "=", query.branchId);
        if (query.paymentStatus) {
          values.push(query.paymentStatus);
          where.push("(" + PAYMENT_STATUS_SQL + ") = $" + values.length);
        }
        if (query.dateFrom) add("createdAt", ">=", query.dateFrom);
        if (query.dateTo) add("createdAt", "<=", query.dateTo);
        if (query.cursor) {
          values.push(query.cursor.createdAt, query.cursor.id);
          where.push('("createdAt" < $' + (values.length - 1) + ' OR ("createdAt" = $' +
            (values.length - 1) + ' AND "id" < $' + values.length + '))');
        }
        values.push(query.limit);
        const r = await c.query(
          'SELECT ' + ORDER_SELECT + ' FROM "Order" WHERE ' + where.join(" AND ") +
            ' ORDER BY "createdAt" DESC, "id" DESC LIMIT $' + values.length,
          values,
        );
        return r.rows as DbOrder[];
      } finally { if (ctx.owns()) c.release(); }
    },
    async listDueReservationOrders(now: Date, limit: number): Promise<DbOrder[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          'SELECT o.* FROM "Order" o WHERE EXISTS (' +
            'SELECT 1 FROM "InventoryReservation" r WHERE r."businessId" = o."businessId" AND r."orderId" = o."id"' +
            ' AND r."status" = \'HELD\' AND r."expiresAt" IS NOT NULL AND r."expiresAt" <= $1)' +
            ' ORDER BY o."createdAt" ASC, o."id" ASC LIMIT $2',
          [now, limit],
        );
        return r.rows as DbOrder[];
      } finally { if (ctx.owns()) c.release(); }
    },
    async createOrderLine(l: Omit<DbOrderLine, "id">): Promise<DbOrderLine> {
      const c = await ctx.client();
      try {
        const row: DbOrderLine = { ...l, id: nid("ol") };
        await c.query(
          'INSERT INTO "OrderLine" ("id", "businessId", "orderId", "position", "productId", "name", "sku", "barcode", "unit", "qty", "priceMinor", "costMinor", "taxRateBps", "discountMinor", "taxMinor", "lineTotalMinor", "bundleComponentsSnapshot", "createdAt")' +
            ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
          [row.id, row.businessId, row.orderId, row.position, row.productId, row.name, row.sku, row.barcode, row.unit,
            row.qty, row.priceMinor, row.costMinor, row.taxRateBps, row.discountMinor, row.taxMinor,
            row.lineTotalMinor,
            row.bundleComponentsSnapshot === null ? null : JSON.stringify(row.bundleComponentsSnapshot),
            row.createdAt],
        );
        return row;
      } finally { if (ctx.owns()) c.release(); }
    },
    async listOrderLines(orderId: string, businessId: string): Promise<DbOrderLine[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          'SELECT ' + ORDER_LINE_SELECT + ' FROM "OrderLine" WHERE "orderId" = $1 AND "businessId" = $2 ORDER BY "position" ASC, "id" ASC',
          [orderId, businessId],
        );
        return r.rows as DbOrderLine[];
      } finally { if (ctx.owns()) c.release(); }
    },
    async createInventoryReservation(r: Omit<DbInventoryReservation, "id">): Promise<DbInventoryReservation> {
      const c = await ctx.client();
      try {
        const row: DbInventoryReservation = { ...r, id: nid("res") };
        await c.query(
          'INSERT INTO "InventoryReservation" ("id", "businessId", "branchId", "orderId", "orderLineId", "productId", "qty", "status", "expiresAt", "idempotencyKey", "createdAt", "updatedAt")' +
            ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
          [row.id, row.businessId, row.branchId, row.orderId, row.orderLineId, row.productId, row.qty, row.status,
            row.expiresAt, row.idempotencyKey, row.createdAt, row.updatedAt],
        );
        return row;
      } finally { if (ctx.owns()) c.release(); }
    },
    async listReservationsByOrder(orderId: string, businessId: string): Promise<DbInventoryReservation[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          'SELECT ' + RESERVATION_SELECT + ' FROM "InventoryReservation" WHERE "orderId" = $1 AND "businessId" = $2 ORDER BY "createdAt" ASC, "id" ASC',
          [orderId, businessId],
        );
        return r.rows as DbInventoryReservation[];
      } finally { if (ctx.owns()) c.release(); }
    },
    async listActiveReservationsByProduct(businessId: string, branchId: string, productId: string): Promise<DbInventoryReservation[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          'SELECT ' + RESERVATION_SELECT + ' FROM "InventoryReservation" WHERE "businessId" = $1 AND "branchId" = $2 AND "productId" = $3 AND "status" = \'HELD\' ORDER BY "createdAt" ASC, "id" ASC',
          [businessId, branchId, productId],
        );
        return r.rows as DbInventoryReservation[];
      } finally { if (ctx.owns()) c.release(); }
    },
    async updateInventoryReservation(
      id: string,
      businessId: string,
      patch: Partial<Omit<DbInventoryReservation, "id" | "businessId" | "orderId" | "orderLineId" | "productId" | "branchId" | "idempotencyKey" | "createdAt">>,
    ): Promise<DbInventoryReservation | null> {
      const c = await ctx.client();
      try {
        const { sets, values } = buildSet(patch);
        const r = await c.query(
          'UPDATE "InventoryReservation" SET ' + (sets.length ? sets.join(", ") + ", " : "") +
            '"updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $' + (values.length + 1) +
            ' AND "businessId" = $' + (values.length + 2) + ' RETURNING ' + RESERVATION_SELECT,
          [...values, id, businessId],
        );
        return (r.rows[0] as DbInventoryReservation | undefined) ?? null;
      } finally { if (ctx.owns()) c.release(); }
    },
    async createFulfillment(f: Omit<DbFulfillment, "id">): Promise<DbFulfillment> {
      const c = await ctx.client();
      try {
        const row: DbFulfillment = { ...f, id: nid("ful") };
        await c.query(
          'INSERT INTO "Fulfillment" ("id", "businessId", "orderId", "type", "status", "branchId", "assignedUserId", "contactName", "email", "phone", "deliveryAddress", "instructions", "version", "readyAt", "dispatchedAt", "deliveredAt", "collectedAt", "failedAt", "cancelledAt", "createdAt", "updatedAt")' +
            ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)',
          [row.id, row.businessId, row.orderId, row.type, row.status, row.branchId, row.assignedUserId, row.contactName,
            row.email, row.phone, row.deliveryAddress === null ? null : JSON.stringify(row.deliveryAddress),
            row.instructions, row.version, row.readyAt, row.dispatchedAt,
            row.deliveredAt, row.collectedAt, row.failedAt, row.cancelledAt, row.createdAt, row.updatedAt],
        );
        return row;
      } finally { if (ctx.owns()) c.release(); }
    },
    async findFulfillmentById(id: string, businessId: string): Promise<DbFulfillment | null> {
      const c = await ctx.client();
      try {
        const r = await c.query('SELECT ' + FULFILLMENT_SELECT + ' FROM "Fulfillment" WHERE "id" = $1 AND "businessId" = $2', [id, businessId]);
        return (r.rows[0] as DbFulfillment | undefined) ?? null;
      } finally { if (ctx.owns()) c.release(); }
    },
    async listFulfillmentsByOrder(orderId: string, businessId: string): Promise<DbFulfillment[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          'SELECT ' + FULFILLMENT_SELECT + ' FROM "Fulfillment" WHERE "orderId" = $1 AND "businessId" = $2 ORDER BY "createdAt" ASC, "id" ASC',
          [orderId, businessId],
        );
        return r.rows as DbFulfillment[];
      } finally { if (ctx.owns()) c.release(); }
    },
    async updateFulfillment(
      id: string,
      businessId: string,
      patch: Partial<Omit<DbFulfillment, "id" | "businessId" | "orderId" | "version" | "createdAt">>,
      expectedVersion: number,
    ): Promise<DbFulfillment | null> {
      const c = await ctx.client();
      try {
        const { sets, values } = buildSet(patch);
        const r = await c.query(
          'UPDATE "Fulfillment" SET ' + (sets.length ? sets.join(", ") + ", " : "") +
            '"version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $' + (values.length + 1) +
            ' AND "businessId" = $' + (values.length + 2) + ' AND "version" = $' + (values.length + 3) +
            ' RETURNING ' + FULFILLMENT_SELECT,
          [...values, id, businessId, expectedVersion],
        );
        return (r.rows[0] as DbFulfillment | undefined) ?? null;
      } finally { if (ctx.owns()) c.release(); }
    },
    async createFulfillmentLine(l: Omit<DbFulfillmentLine, "id">): Promise<DbFulfillmentLine> {
      const c = await ctx.client();
      try {
        const row: DbFulfillmentLine = { ...l, id: nid("fl") };
        await c.query(
          'INSERT INTO "FulfillmentLine" ("id", "businessId", "fulfillmentId", "orderLineId", "qty", "createdAt") VALUES ($1,$2,$3,$4,$5,$6)',
          [row.id, row.businessId, row.fulfillmentId, row.orderLineId, row.qty, row.createdAt],
        );
        return row;
      } finally { if (ctx.owns()) c.release(); }
    },
    async listFulfillmentLines(fulfillmentId: string, businessId: string): Promise<DbFulfillmentLine[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          'SELECT ' + FULFILLMENT_LINE_SELECT + ' FROM "FulfillmentLine" WHERE "fulfillmentId" = $1 AND "businessId" = $2 ORDER BY "createdAt" ASC, "id" ASC',
          [fulfillmentId, businessId],
        );
        return r.rows as DbFulfillmentLine[];
      } finally { if (ctx.owns()) c.release(); }
    },
    async createOrderAccessToken(t: Omit<DbOrderAccessToken, "id">): Promise<DbOrderAccessToken> {
      const c = await ctx.client();
      try {
        const row: DbOrderAccessToken = { ...t, id: nid("oat") };
        await c.query(
          'INSERT INTO "OrderAccessToken" ("id", "businessId", "orderId", "kind", "tokenHash", "expiresAt", "revokedAt", "createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [row.id, row.businessId, row.orderId, row.kind, row.tokenHash, row.expiresAt, row.revokedAt, row.createdAt],
        );
        return row;
      } finally { if (ctx.owns()) c.release(); }
    },
    async findOrderAccessTokenByHash(tokenHash: string): Promise<DbOrderAccessToken | null> {
      const c = await ctx.client();
      try {
        const r = await c.query('SELECT ' + ACCESS_TOKEN_SELECT + ' FROM "OrderAccessToken" WHERE "tokenHash" = $1', [tokenHash]);
        return (r.rows[0] as DbOrderAccessToken | undefined) ?? null;
      } finally { if (ctx.owns()) c.release(); }
    },
    async listActiveOrderAccessTokens(orderId: string, businessId: string, kind: DbOrderAccessTokenKind, now: Date): Promise<DbOrderAccessToken[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          'SELECT ' + ACCESS_TOKEN_SELECT + ' FROM "OrderAccessToken" WHERE "orderId" = $1 AND "businessId" = $2 AND "kind" = $3 AND "revokedAt" IS NULL AND "expiresAt" > $4 ORDER BY "createdAt" ASC, "id" ASC',
          [orderId, businessId, kind, now],
        );
        return r.rows as DbOrderAccessToken[];
      } finally { if (ctx.owns()) c.release(); }
    },
    async revokeOrderAccessToken(id: string, businessId: string, revokedAt: Date): Promise<DbOrderAccessToken | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          'UPDATE "OrderAccessToken" SET "revokedAt" = $1 WHERE "id" = $2 AND "businessId" = $3 RETURNING ' + ACCESS_TOKEN_SELECT,
          [revokedAt, id, businessId],
        );
        return (r.rows[0] as DbOrderAccessToken | undefined) ?? null;
      } finally { if (ctx.owns()) c.release(); }
    },
  };
}
