import type {
  DbBalance,
  DbInventoryCount,
  DbInventoryCountLine,
  DbMovement,
  DbPort,
} from "../db.port";

type MemoryInventoryContext = {
  movements: Map<string, DbMovement>;
  balances: Map<string, DbBalance>;
  inventoryCounts: Map<string, DbInventoryCount>;
  inventoryCountLines: Map<string, DbInventoryCountLine>;
  inventoryCountSeq: Map<string, number>;
  balanceKey: (businessId: string, branchId: string | null | undefined, productId: string) => string;
  nextId: (prefix: string) => string;
};

export function createMemoryInventory(context: MemoryInventoryContext): Pick<DbPort, "createMovement" | "listMovements" | "listMovementsByBusiness" | "listMovementsPage" | "upsertBalance" | "findBalance" | "listBalances" | "nextInventoryCountNo" | "createInventoryCount" | "findInventoryCountById" | "listInventoryCountsByBusiness" | "updateInventoryCount" | "createInventoryCountLine" | "listInventoryCountLines" | "updateInventoryCountLine" | "deleteInventoryCountLines"> {
  const {
    movements,
    balances,
    inventoryCounts,
    inventoryCountLines,
    inventoryCountSeq,
    balanceKey,
    nextId: nid,
  } = context;

  return {
    async createMovement(m) {
      const row = { ...m, id: nid("mov") };
      movements.set(row.id, row);
      return row;
    },
    async listMovements(productId, businessId, branchId?) {
      return [...movements.values()].filter(
        (m) =>
          m.productId === productId &&
          m.businessId === businessId &&
          (branchId === undefined || (m.branchId ?? null) === (branchId ?? null)),
      );
    },
    async listMovementsByBusiness(businessId) {
      return [...movements.values()].filter((m) => m.businessId === businessId);
    },
    async listMovementsPage(businessId, afterId, limit) {
      const rows = [...movements.values()]
        .filter((m) => m.businessId === businessId && (afterId === null || m.id > afterId))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return rows.slice(0, limit);
    },
    async upsertBalance(b) {
      const key = balanceKey(b.businessId, b.branchId, b.productId);
      const existing = balances.get(key);
      const row = existing ? { ...existing, qtyOnHand: b.qtyOnHand, updatedAt: new Date() } : { ...b, id: nid("bal"), updatedAt: new Date() };
      balances.set(key, row);
      return row;
    },
    async findBalance(productId, businessId, branchId = null) {
      const row = balances.get(balanceKey(businessId, branchId, productId)) ?? null;
      if (!row || row.businessId !== businessId) return null;
      return row;
    },
    async listBalances(businessId) {
      return [...balances.values()].filter((b) => b.businessId === businessId);
    },
    async nextInventoryCountNo(businessId) {
      const year = new Date().getUTCFullYear();
      const seq = (inventoryCountSeq.get(businessId) ?? 0) + 1;
      inventoryCountSeq.set(businessId, seq);
      return `CNT-${year}-${String(seq).padStart(6, "0")}`;
    },
    async createInventoryCount(c) {
      const now = new Date();
      const row: DbInventoryCount = { ...c, id: nid("cnt"), createdAt: now, updatedAt: now };
      inventoryCounts.set(row.id, row);
      return row;
    },
    async findInventoryCountById(id, businessId) {
      const row = inventoryCounts.get(id) ?? null;
      return row && row.businessId === businessId ? row : null;
    },
    async listInventoryCountsByBusiness(businessId) {
      return [...inventoryCounts.values()].filter((row) => row.businessId === businessId);
    },
    async updateInventoryCount(id, businessId, patch, expectedVersion) {
      const row = inventoryCounts.get(id) ?? null;
      if (!row || row.businessId !== businessId || row.version !== expectedVersion) return null;
      const next = { ...row, ...patch, version: expectedVersion + 1, updatedAt: new Date() };
      inventoryCounts.set(id, next);
      return next;
    },
    async createInventoryCountLine(l) {
      const now = new Date();
      const row: DbInventoryCountLine = { ...l, id: nid("cntl"), createdAt: now, updatedAt: now };
      inventoryCountLines.set(row.id, row);
      return row;
    },
    async listInventoryCountLines(countId, businessId) {
      return [...inventoryCountLines.values()].filter((row) => row.inventoryCountId === countId && row.businessId === businessId);
    },
    async updateInventoryCountLine(id, businessId, patch) {
      const row = inventoryCountLines.get(id) ?? null;
      if (!row || row.businessId !== businessId) return null;
      const next = { ...row, ...patch, updatedAt: new Date() };
      inventoryCountLines.set(id, next);
      return next;
    },
    async deleteInventoryCountLines(countId, businessId) {
      for (const [id, row] of inventoryCountLines) if (row.inventoryCountId === countId && row.businessId === businessId) inventoryCountLines.delete(id);
    },
  };
}
