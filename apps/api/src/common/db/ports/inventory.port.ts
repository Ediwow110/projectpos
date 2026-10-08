import type {
  DbMovement,
  DbBalance,
  DbInventoryCount,
  DbInventoryCountLine,
} from "../types";

export interface InventoryPort {
  createMovement(m: Omit<DbMovement, "id">): Promise<DbMovement>;
  listMovements(productId: string, businessId: string, branchId?: string | null): Promise<DbMovement[]>;
  listMovementsByBusiness(businessId: string): Promise<DbMovement[]>;
  listMovementsPage(businessId: string, afterId: string | null, limit: number): Promise<DbMovement[]>;
  upsertBalance(b: Omit<DbBalance, "id">): Promise<DbBalance>;
  findBalance(productId: string, businessId: string, branchId?: string | null): Promise<DbBalance | null>;
  listBalances(businessId: string): Promise<DbBalance[]>;
  nextInventoryCountNo(businessId: string): Promise<string>;
  createInventoryCount(c: Omit<DbInventoryCount, "id" | "createdAt" | "updatedAt">): Promise<DbInventoryCount>;
  findInventoryCountById(id: string, businessId: string): Promise<DbInventoryCount | null>;
  listInventoryCountsByBusiness(businessId: string): Promise<DbInventoryCount[]>;
  updateInventoryCount(id: string, businessId: string, patch: Partial<Omit<DbInventoryCount, "id" | "businessId" | "createdAt" | "version">>, expectedVersion: number): Promise<DbInventoryCount | null>;
  createInventoryCountLine(l: Omit<DbInventoryCountLine, "id" | "createdAt" | "updatedAt">): Promise<DbInventoryCountLine>;
  listInventoryCountLines(countId: string, businessId: string): Promise<DbInventoryCountLine[]>;
  updateInventoryCountLine(id: string, businessId: string, patch: Partial<Omit<DbInventoryCountLine, "id" | "businessId" | "inventoryCountId" | "createdAt">>): Promise<DbInventoryCountLine | null>;
  deleteInventoryCountLines(countId: string, businessId: string): Promise<void>;
}
