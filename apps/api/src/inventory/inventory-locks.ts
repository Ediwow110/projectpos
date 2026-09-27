import type { DbPort } from "../common/db.port";

export interface InventoryLockTarget {
  productId: string;
  branchId?: string | null;
}

export function inventoryLockKey(
  businessId: string,
  productId: string,
  branchId?: string | null,
): string {
  return `${businessId}:${branchId ?? ""}:${productId}`;
}

export async function withInventoryLocks<T>(
  db: Pick<DbPort, "withLock">,
  businessId: string,
  targets: InventoryLockTarget[],
  fn: () => Promise<T>,
): Promise<T> {
  const keys = [
    ...new Set(
      targets.map((target) =>
        inventoryLockKey(
          businessId,
          target.productId,
          target.branchId ?? null,
        ),
      ),
    ),
  ].sort();

  const acquire = async (index: number): Promise<T> => {
    if (index >= keys.length) return fn();
    return db.withLock(keys[index]!, () => acquire(index + 1));
  };

  return acquire(0);
}
