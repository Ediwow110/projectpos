import type { DbPayment, DbRefund, DbRefundItem, DbSale } from "../common/db.port";
import type { OrderPaymentStatus } from "./order-types";

export function deriveOrderPaymentStatus(input: {
  sale: Pick<DbSale, "status" | "totalMinor"> | null;
  payments: Array<Pick<DbPayment, "status" | "amountMinor">>;
  refunds: Array<Pick<DbRefund, "id" | "status" | "totalMinor">>;
  refundItems: Array<Pick<DbRefundItem, "refundId" | "amountMinor">>;
}): OrderPaymentStatus {
  const { sale, payments, refunds } = input;
  void input.refundItems;
  if (!sale) return "UNPAID";

  const approvedRefundTotal = refunds
    .filter((row) => row.status === "APPROVED")
    .reduce((sum, row) => sum + row.totalMinor, 0);
  if (sale.status === "REFUNDED" || (sale.totalMinor > 0 && approvedRefundTotal >= sale.totalMinor)) {
    return "REFUNDED";
  }
  if (sale.status === "PARTIALLY_REFUNDED" || approvedRefundTotal > 0) return "PARTIALLY_REFUNDED";
  if (payments.some((row) => row.status === "UNKNOWN")) return "UNKNOWN";

  const succeeded = payments
    .filter((row) => row.status === "SUCCEEDED")
    .reduce((sum, row) => sum + row.amountMinor, 0);
  if (sale.totalMinor > 0 && succeeded >= sale.totalMinor) return "PAID";

  switch (sale.status) {
    case "DRAFT":
      return "UNPAID";
    case "PENDING_PAYMENT":
      return "PENDING";
    case "PAYMENT_FAILED":
      return "FAILED";
    case "PAYMENT_UNKNOWN":
      return "UNKNOWN";
    case "RECONCILED":
      return payments.some((row) => row.status === "FAILED") ? "FAILED" : "PENDING";
    case "PAID":
    case "COMPLETED":
    case "REFUND_REQUESTED":
      return "PAID";
    case "VOIDED":
      return "UNPAID";
    case "PARTIALLY_REFUNDED":
      return "PARTIALLY_REFUNDED";
    case "REFUNDED":
      return "REFUNDED";
    default:
      return "UNPAID";
  }
}
