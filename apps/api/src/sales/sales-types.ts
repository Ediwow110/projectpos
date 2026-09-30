import type {
  DbCustomer,
  DbExchange,
  DbPayment,
  DbRefund,
  DbRefundItem,
  DbSale,
  DbSaleItem,
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
}

export interface PaymentInput {
  method: string;
  amountMinor: number;
  providerRef?: string;
}

export type SaleWithLines = DbSale & {
  items: DbSaleItem[];
  payments: DbPayment[];
};

export type SaleDetail = SaleWithLines & {
  refunds: Array<DbRefund & { items: DbRefundItem[] }>;
  exchanges: DbExchange[];
  exchangeOrigin: (DbExchange & { originalReceiptNo: string }) | null;
  customer: DbCustomer | null;
};
