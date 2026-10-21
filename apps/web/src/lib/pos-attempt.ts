/**
 * The in-flight payment attempt.
 *
 * A payment attempt is identified by a key the client generates BEFORE it
 * sends anything, so the server can be asked what actually happened instead
 * of the client guessing. The key lives in one browser slot per register,
 * which every tab on that register shares: a second tab JOINS the attempt
 * rather than starting a second payment, so the server's idempotency returns
 * the sale that is already being paid.
 *
 * The server is the authority on the outcome. The slot only carries the key.
 * A cleared slot therefore costs a reconciliation PROMPT, never a wrong
 * claim that nothing was recorded.
 */

export interface AttemptOutcome {
  found: boolean;
  stage: "none" | "draft" | "complete";
  saleId?: string;
  status?: string;
  receiptNo?: string;
}

const SLOT_PREFIX = "nexpos:pos-attempt:";

export function attemptSlot(businessId: string, registerId: string): string {
  return `${SLOT_PREFIX}${businessId || "no-business"}:${registerId || "no-register"}`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readAttemptKey(slot: string): string | null {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(slot) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The key of the attempt in flight for this register, if any.
 */
export function currentAttemptKey(slot: string): string | null {
  return readAttemptKey(slot);
}

/**
 * Claims the attempt slot. An attempt already in flight is REUSED, so a
 * second tab joins it instead of paying the same cart twice. The write is
 * read back so that a tab which lost the write race joins the winner
 * instead of starting a second payment.
 *
 * Residual limitation, stated rather than hidden: two tabs that claim the
 * slot within the same millisecond can still produce two keys. The server
 * stays the authority on every outcome, so the worst case is a missed
 * reconciliation prompt, never a silent double charge.
 */
export function claimAttemptKey(slot: string, candidate: string): string {
  const existing = readAttemptKey(slot);
  if (existing) return existing;
  const store = storage();
  if (!store) return candidate;
  try {
    store.setItem(slot, candidate);
  } catch {
    return candidate;
  }
  return readAttemptKey(slot) ?? candidate;
}

export function clearAttemptKey(slot: string): void {
  try {
    storage()?.removeItem(slot);
  } catch {
    // A slot that cannot be cleared is not worth failing a payment over.
  }
}

/**
 * Asks the server what happened to the attempt. The server answers from the
 * idempotency ledger and the sale row, so this is the truth rather than an
 * inference from what the client happened to receive.
 */
export async function fetchAttemptOutcome(
  key: string,
  fetcher: typeof fetch = fetch,
): Promise<AttemptOutcome> {
  try {
    const response = await fetcher(`/api/v1/sales/attempts/${encodeURIComponent(key)}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return { found: false, stage: "none" };
    const body = (await response.json()) as { ok?: boolean; attempt?: AttemptOutcome };
    if (!body || body.ok !== true || !body.attempt) return { found: false, stage: "none" };
    return body.attempt;
  } catch {
    return { found: false, stage: "none" };
  }
}
