import type {
  DbCustomer,
  DbExchange,
  DbPayment,
  DbRefund,
  DbRefundItem,
  DbSale,
  DbSaleItem,
  DbSaleGiftCardLoad,
} from "../common/db.port";

export interface DraftLineInput {
  productId: string;
  qty: number;
  lineDiscountMinor: number;
}

export interface DraftInput {
  lines: DraftLineInput[];
  orderDiscountMinor: number;
  customerId?: string;
  customerName?: string;
  notes?: string;
  registerId?: string;
  branchId?: string | null;
  giftCardLoad?: {
    amountMinor: number;
    kind: "NEW" | "RELOAD";
    giftCardId?: string;
  };
}

export interface PaymentInput {
  method: string;
  amountMinor: number;
  providerRef?: string;
  internalInstrumentId?: string;
}

export type SaleWithLines = DbSale & {
  items: DbSaleItem[];
  payments: DbPayment[];
};

export type SaleDetail = SaleWithLines & {
  refunds: Array<DbRefund & { items: DbRefundItem[] }>;
  giftCardLoads: Array<DbSaleGiftCardLoad & { refundedMinor: number; refundableMinor: number }>;
  exchanges: DbExchange[];
  exchangeOrigin: (DbExchange & { originalReceiptNo: string }) | null;
  customer: DbCustomer | null;
};
