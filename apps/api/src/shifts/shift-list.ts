import type { DbShift } from "../common/db.port";

export interface ShiftCloseCandidate {
  id: string;
  registerId: string;
  branchId: string | null;
  status: "OPEN";
  openedBy: string;
  closeCandidate: true;
}

export type ShiftListItem = DbShift | ShiftCloseCandidate;

export interface ShiftListOptions {
  cursor?: string;
  limit?: number;
  status?: string;
  registerId?: string;
  includeCloseCandidates?: boolean;
}

/**
 * Restricts cashier read-model fields before cursor pagination.
 * Caller remains responsible for tenant-scoped DB reads.
 */
export function selectShiftList(
  input: DbShift[],
  opts: ShiftListOptions,
  role: string,
  actorId: string,
): { items: ShiftListItem[]; nextCursor: string | null } {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  let rows = input;
  if (opts.status) rows = rows.filter((s) => s.status === opts.status);
  if (opts.registerId) rows = rows.filter((s) => s.registerId === opts.registerId);
  const candidateIds = new Set<string>();
  if (role === "cashier") {
    if (opts.includeCloseCandidates) {
      for (const row of rows) {
        if (row.status === "OPEN" && row.openedBy !== actorId) candidateIds.add(row.id);
      }
    }
    rows = rows.filter((row) => row.openedBy === actorId || candidateIds.has(row.id));
  }
  rows = [...rows].sort((a, b) => (a.id < b.id ? 1 : -1));
  let start = 0;
  if (opts.cursor) {
    const idx = rows.findIndex((s) => s.id === opts.cursor);
    start = idx === -1 ? 0 : idx + 1;
  }
  const items = rows.slice(start, start + limit).map((row): ShiftListItem => {
    if (!candidateIds.has(row.id)) return row;
    return {
      id: row.id,
      registerId: row.registerId,
      branchId: row.branchId ?? null,
      status: "OPEN",
      openedBy: row.openedBy,
      closeCandidate: true,
    };
  });
  const nextCursor = start + limit < rows.length ? items[items.length - 1].id : null;
  return { items, nextCursor };
}
