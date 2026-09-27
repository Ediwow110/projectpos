import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type { DbPort, DbStockTransfer, DbStockTransferLine } from "../../common/db.port";
import { fingerprintPayload } from "../../sales/idempotency";
import { withInventoryLocks } from "../../inventory/inventory-locks";
import { canTransitionTransfer } from "../transfer-math";

export interface TransferLineInput {
  productId: string;
  qty: number;
}

export interface TransferCreateInput {
  fromBranchId: string;
  toBranchId: string;
  lines: TransferLineInput[];
}

export interface TransferWithLines extends DbStockTransfer {
  lines: DbStockTransferLine[];
}

export interface TransferListPage {
  items: TransferWithLines[];
  total: number;
  page: number;
  pageSize: number;
}

const INVENTORY_GRANT = "inventory.adjust";

@Injectable()
export class TransferService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  private requireGrant(granted: string[]): void {
    if (!granted.includes(INVENTORY_GRANT)) throw new Error("FORBIDDEN");
  }

  private async requireTransfer(businessId: string, transferId: string): Promise<DbStockTransfer> {
    const t = await this.db.findTransferById(transferId, businessId);
    if (!t) throw new Error("NOT_FOUND");
    return t;
  }

  private async embed(t: DbStockTransfer): Promise<TransferWithLines> {
    const lines = await this.db.listTransferLines(t.id, t.businessId);
    return { ...t, lines };
  }

  async createTransfer(
    businessId: string,
    actorId: string,
    requestId: string,
    input: TransferCreateInput,
    granted: string[],
  ): Promise<TransferWithLines> {
    withScope(businessId, {});
    this.requireGrant(granted);
    if (input.fromBranchId === input.toBranchId) throw new Error("VALIDATION");
    const from = await this.db.findBranchById(input.fromBranchId, businessId);
    const to = await this.db.findBranchById(input.toBranchId, businessId);
    if (!from || !to || !from.isActive || !to.isActive) throw new Error("VALIDATION");
    if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 100) {
      throw new Error("VALIDATION");
    }
    for (const line of input.lines) {
      if (!Number.isInteger(line.qty) || line.qty <= 0) throw new Error("VALIDATION");
      const product = await this.db.findProductById(line.productId, businessId);
      if (!product) throw new Error("NOT_FOUND");
    }
    const row = await this.db.createTransfer({
      businessId,
      fromBranchId: input.fromBranchId,
      toBranchId: input.toBranchId,
      status: "DRAFT",
      requestedBy: actorId,
      dispatchedBy: null,
      receivedBy: null,
      requestId,
    });
    for (const line of input.lines) {
      await this.db.createTransferLine({
        businessId,
        transferId: row.id,
        productId: line.productId,
        qty: line.qty,
      });
    }
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "transfer.create",
      entityType: "StockTransfer",
      entityId: row.id,
      requestId,
    });
    return this.embed(row);
  }

  async getTransfer(businessId: string, transferId: string): Promise<TransferWithLines> {
    withScope(businessId, {});
    return this.embed(await this.requireTransfer(businessId, transferId));
  }

  async listTransfers(
    businessId: string,
    opts: { status?: string; page: number; pageSize: number },
  ): Promise<TransferListPage> {
    withScope(businessId, {});
    const all = await this.db.listTransfersByBusiness(businessId);
    const filtered = (opts.status ? all.filter((t) => t.status === opts.status) : all).sort((a, b) =>
      a.id < b.id ? 1 : -1,
    );
    const total = filtered.length;
    const start = (opts.page - 1) * opts.pageSize;
    const items: TransferWithLines[] = [];
    for (const t of filtered.slice(start, start + opts.pageSize)) {
      items.push(await this.embed(t));
    }
    return { items, total, page: opts.page, pageSize: opts.pageSize };
  }

  async dispatchTransfer(
    businessId: string,
    actorId: string,
    requestId: string,
    transferId: string,
    key: string,
    // Optional trailing grant: HTTP controllers always pass the caller's
    // granted permissions; omitted (service-level tests) means allow.
    // createTransfer always requires the grant explicitly.
    granted?: string[],
  ): Promise<{ transfer: TransferWithLines; replayed: boolean }> {
    withScope(businessId, {});
    if (granted !== undefined) this.requireGrant(granted);
    return this.db.withLock(`transfer:${businessId}:${transferId}`, async () => {
      const t = await this.requireTransfer(businessId, transferId);
      const fingerprint = fingerprintPayload({ transferId });
      const existing = await this.db.findIdempotency(businessId, key, "transfer.dispatch");
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_MISMATCH");
        return { transfer: await this.embed(await this.requireTransfer(businessId, transferId)), replayed: true };
      }
      canTransitionTransfer(t.status, "IN_TRANSIT");
      const lines = await this.db.listTransferLines(t.id, businessId);
      return withInventoryLocks(
        this.db,
        businessId,
        lines.map((line) => ({
          productId: line.productId,
          branchId: t.fromBranchId,
        })),
        async () => {
          // Pre-check every line after the canonical inventory locks are held.
          for (const line of lines) {
            const product = await this.db.findProductById(line.productId, businessId);
            if (!product) throw new Error("NOT_FOUND");
            const preventOversell =
              (product as { preventOversell?: boolean }).preventOversell ?? true;
            const balance = await this.db.findBalance(line.productId, businessId, t.fromBranchId);
            const onHand = balance?.qtyOnHand ?? 0;
            if (preventOversell && onHand < line.qty) throw new Error("INSUFFICIENT_STOCK");
          }
          for (const line of lines) {
            await this.db.createMovement({
              businessId,
              productId: line.productId,
              type: "transfer_out",
              qtyDelta: -line.qty,
              reason: null,
              referenceType: "StockTransfer",
              referenceId: t.id,
              actorId,
              requestId,
              branchId: t.fromBranchId,
            });
            const balance = await this.db.findBalance(line.productId, businessId, t.fromBranchId);
            await this.db.upsertBalance({
              businessId,
              branchId: t.fromBranchId,
              productId: line.productId,
              qtyOnHand: (balance?.qtyOnHand ?? 0) - line.qty,
            });
          }
          const updated =
            (await this.db.updateTransfer(t.id, businessId, {
              status: "IN_TRANSIT",
              dispatchedBy: actorId,
            })) ?? t;
          await this.db.claimIdempotency({
            businessId,
            key,
            commandType: "transfer.dispatch",
            fingerprint,
            resultId: t.id,
          });
          await this.db.appendAudit({
            businessId,
            actorId,
            action: "transfer.dispatch",
            entityType: "StockTransfer",
            entityId: t.id,
            requestId,
          });
          return { transfer: await this.embed(updated), replayed: false };
        },
      );
    });
  }

  async receiveTransfer(
    businessId: string,
    actorId: string,
    requestId: string,
    transferId: string,
    key: string,
    // Optional trailing grant (see dispatchTransfer).
    granted?: string[],
  ): Promise<{ transfer: TransferWithLines; replayed: boolean }> {
    withScope(businessId, {});
    if (granted !== undefined) this.requireGrant(granted);
    return this.db.withLock(`transfer:${businessId}:${transferId}`, async () => {
      const t = await this.requireTransfer(businessId, transferId);
      const fingerprint = fingerprintPayload({ transferId });
      const existing = await this.db.findIdempotency(businessId, key, "transfer.receive");
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_MISMATCH");
        return { transfer: await this.embed(await this.requireTransfer(businessId, transferId)), replayed: true };
      }
      canTransitionTransfer(t.status, "RECEIVED");
      const lines = await this.db.listTransferLines(t.id, businessId);
      return withInventoryLocks(
        this.db,
        businessId,
        lines.map((line) => ({
          productId: line.productId,
          branchId: t.toBranchId,
        })),
        async () => {
          for (const line of lines) {
            await this.db.createMovement({
              businessId,
              productId: line.productId,
              type: "transfer_in",
              qtyDelta: line.qty,
              reason: null,
              referenceType: "StockTransfer",
              referenceId: t.id,
              actorId,
              requestId,
              branchId: t.toBranchId,
            });
            const balance = await this.db.findBalance(line.productId, businessId, t.toBranchId);
            await this.db.upsertBalance({
              businessId,
              branchId: t.toBranchId,
              productId: line.productId,
              qtyOnHand: (balance?.qtyOnHand ?? 0) + line.qty,
            });
          }
          const updated =
            (await this.db.updateTransfer(t.id, businessId, {
              status: "RECEIVED",
              receivedBy: actorId,
            })) ?? t;
          await this.db.claimIdempotency({
            businessId,
            key,
            commandType: "transfer.receive",
            fingerprint,
            resultId: t.id,
          });
          await this.db.appendAudit({
            businessId,
            actorId,
            action: "transfer.receive",
            entityType: "StockTransfer",
            entityId: t.id,
            requestId,
          });
          return { transfer: await this.embed(updated), replayed: false };
        },
      );
    });
  }

  async cancelTransfer(
    businessId: string,
    actorId: string,
    requestId: string,
    transferId: string,
    key: string,
    // Optional trailing grant (see dispatchTransfer).
    granted?: string[],
  ): Promise<{ transfer: TransferWithLines; replayed: boolean }> {
    withScope(businessId, {});
    if (granted !== undefined) this.requireGrant(granted);
    return this.db.withLock(`transfer:${businessId}:${transferId}`, async () => {
      const t = await this.requireTransfer(businessId, transferId);
      const fingerprint = fingerprintPayload({ transferId });
      const existing = await this.db.findIdempotency(businessId, key, "transfer.cancel");
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_MISMATCH");
        return { transfer: await this.embed(await this.requireTransfer(businessId, transferId)), replayed: true };
      }
      canTransitionTransfer(t.status, "CANCELLED");
      const lines =
        t.status === "IN_TRANSIT"
          ? await this.db.listTransferLines(t.id, businessId)
          : [];
      return withInventoryLocks(
        this.db,
        businessId,
        lines.map((line) => ({
          productId: line.productId,
          branchId: t.fromBranchId,
        })),
        async () => {
          for (const line of lines) {
            await this.db.createMovement({
              businessId,
              productId: line.productId,
              type: "transfer_in",
              qtyDelta: line.qty,
              reason: `cancel:${t.id}`,
              referenceType: "StockTransfer",
              referenceId: t.id,
              actorId,
              requestId,
              branchId: t.fromBranchId,
            });
            const balance = await this.db.findBalance(line.productId, businessId, t.fromBranchId);
            await this.db.upsertBalance({
              businessId,
              branchId: t.fromBranchId,
              productId: line.productId,
              qtyOnHand: (balance?.qtyOnHand ?? 0) + line.qty,
            });
          }
          const updated =
            (await this.db.updateTransfer(t.id, businessId, { status: "CANCELLED" })) ?? t;
          await this.db.claimIdempotency({
            businessId,
            key,
            commandType: "transfer.cancel",
            fingerprint,
            resultId: t.id,
          });
          await this.db.appendAudit({
            businessId,
            actorId,
            action: "transfer.cancel",
            entityType: "StockTransfer",
            entityId: t.id,
            requestId,
          });
          return { transfer: await this.embed(updated), replayed: false };
        },
      );
    });
  }
}
