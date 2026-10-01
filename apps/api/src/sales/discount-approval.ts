import { fingerprintPayload } from "./idempotency";

/**
 * Canonical discount approval fingerprint.
 *
 * The payload shape MUST stay identical to the `discount` branch of
 * ManagerApprovalPolicyService.resolveRequirement(): a grant minted through
 * POST /api/v1/approvals/manager is consumed by POST /api/v1/sales/drafts, so
 * any divergence in this shape makes the consumed fingerprint mismatch and the
 * approval fail closed as FORBIDDEN. `kind` is part of the canonical payload
 * because the generic policy service includes it for every action kind.
 */
export function discountApprovalFingerprint(input: {
  lines: Array<{ productId: string; qty: number; lineDiscountMinor?: number }>;
  orderDiscountMinor?: number;
}): string {
  const lines = input.lines
    .map((line) => ({
      productId: line.productId,
      qty: line.qty,
      lineDiscountMinor: line.lineDiscountMinor ?? 0,
    }))
    .sort((a, b) =>
      a.productId.localeCompare(b.productId) ||
      a.qty - b.qty ||
      a.lineDiscountMinor - b.lineDiscountMinor,
    );
  return fingerprintPayload({
    kind: "discount",
    lines,
    orderDiscountMinor: input.orderDiscountMinor ?? 0,
  });
}
