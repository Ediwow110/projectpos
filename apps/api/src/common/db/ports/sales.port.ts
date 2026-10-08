import type {
  DbMembership,
  DbPlan,
  DbSubscription,
  DbInvoice,
  DbUsageCounter,
  DbFeatureFlag,
  DbWebhookEvent,
  DbApiToken,
  DbPrinter,
  DbPrintJob,
  DbDisplayToken,
  DbSaleItemBundleComponent,
  DbSale,
  DbSaleItem,
  DbPayment,
  DbHeldSale,
  DbIdempotency,
  DbRegister,
  DbShift,
  DbCashMovement,
  DbCustomer,
  DbGiftCard,
  DbGiftCardTransaction,
  DbStoreCreditAccount,
  DbStoreCreditTransaction,
  DbLoyaltyProgram,
  DbLoyaltyAccount,
  DbLoyaltyTransaction,
  DbSaleGiftCardLoad,
  DbSaleLoyalty,
  DbSaleItemLoyaltyAllocation,
  DbRefund,
  DbRefundItem,
  DbExchange,
  DbExpense,
  DbBranch,
  DbStockTransfer,
  DbStockTransferLine,
  DbDevice,
} from "../types";

export interface SalesPort {
  createSale(s: Omit<DbSale, "id">): Promise<DbSale>;
  findSaleById(id: string, businessId: string): Promise<DbSale | null>;
  listSalesByBusiness(businessId: string): Promise<DbSale[]>;
  listSalesPage(businessId: string, afterId: string | null, limit: number): Promise<DbSale[]>;
  updateSale(id: string, businessId: string, patch: Partial<Omit<DbSale, "id" | "businessId">>): Promise<DbSale | null>;
  createSaleItem(
    i: Omit<DbSaleItem, "id" | "position"> & { position?: number },
  ): Promise<DbSaleItem>;
  listSaleItems(saleId: string, businessId: string): Promise<DbSaleItem[]>;
  // Phase 12 bulk read: reporting groups these by saleId in one round-trip
  // instead of two queries per sale (PLAN §12 forbids N+1 patterns).
  listSaleItemsByBusiness(businessId: string): Promise<DbSaleItem[]>;
  createSaleItemBundleComponent(c: Omit<DbSaleItemBundleComponent, "id" | "createdAt">): Promise<DbSaleItemBundleComponent>;
  listSaleItemBundleComponents(saleItemId: string, businessId: string): Promise<DbSaleItemBundleComponent[]>;
  createPayment(p: Omit<DbPayment, "id">): Promise<DbPayment>;
  findPaymentById(id: string, businessId: string): Promise<DbPayment | null>;
  listPaymentsBySale(saleId: string, businessId: string): Promise<DbPayment[]>;
  listPaymentsByBusiness(businessId: string): Promise<DbPayment[]>;
  updatePayment(id: string, businessId: string, patch: Partial<Omit<DbPayment, "id" | "businessId">>): Promise<DbPayment | null>;
  createHeldSale(h: Omit<DbHeldSale, "id">): Promise<DbHeldSale>;
  findHeldSaleById(id: string, businessId: string): Promise<DbHeldSale | null>;
  listHeldSales(businessId: string, actorId: string): Promise<DbHeldSale[]>;
  markHeldResumed(id: string, businessId: string): Promise<void>;
  claimIdempotency(r: DbIdempotency): Promise<void>;
  findIdempotency(businessId: string, key: string, commandType: string): Promise<DbIdempotency | null>;
  nextReceiptNo(businessId: string): Promise<string>;
  createRegister(r: Omit<DbRegister, "id">): Promise<DbRegister>;
  listRegisters(businessId: string): Promise<DbRegister[]>;
  findRegisterById(id: string, businessId: string): Promise<DbRegister | null>;
  updateRegister(id: string, businessId: string, patch: Partial<Omit<DbRegister, "id" | "businessId">>): Promise<DbRegister | null>;
  createShift(s: Omit<DbShift, "id">): Promise<DbShift>;
  findShiftById(id: string, businessId: string): Promise<DbShift | null>;
  findOpenShiftByRegister(businessId: string, registerId: string): Promise<DbShift | null>;
  listShiftsByBusiness(businessId: string): Promise<DbShift[]>;
  updateShift(id: string, businessId: string, patch: Partial<Omit<DbShift, "id" | "businessId">>): Promise<DbShift | null>;
  createCashMovement(m: Omit<DbCashMovement, "id">): Promise<DbCashMovement>;
  listCashMovementsByShift(shiftId: string, businessId: string): Promise<DbCashMovement[]>;
  createCustomer(c: Omit<DbCustomer, "id">): Promise<DbCustomer>;
  listCustomersByBusiness(businessId: string): Promise<DbCustomer[]>;
  findCustomerById(id: string, businessId: string): Promise<DbCustomer | null>;
  updateCustomer(id: string, businessId: string, patch: Partial<Omit<DbCustomer, "id" | "businessId">>): Promise<DbCustomer | null>;
  createGiftCard(c: Omit<DbGiftCard, "id" | "createdAt" | "updatedAt">): Promise<DbGiftCard>;
  findGiftCardByHash(codeHash: string, businessId: string): Promise<DbGiftCard | null>;
  findGiftCardById(id: string, businessId: string): Promise<DbGiftCard | null>;
  listGiftCards(businessId: string): Promise<DbGiftCard[]>;
  updateGiftCard(id: string, businessId: string, patch: Partial<Omit<DbGiftCard, "id" | "businessId" | "createdAt">>): Promise<DbGiftCard | null>;
  createGiftCardTransaction(t: Omit<DbGiftCardTransaction, "id" | "createdAt">): Promise<DbGiftCardTransaction>;
  listGiftCardTransactions(giftCardId: string, businessId: string): Promise<DbGiftCardTransaction[]>;
  findGiftCardTransactionByIdempotency(businessId: string, idempotencyKey: string): Promise<DbGiftCardTransaction | null>;
  createStoreCreditAccount(a: Omit<DbStoreCreditAccount, "id" | "createdAt" | "updatedAt">): Promise<DbStoreCreditAccount>;
  findStoreCreditAccount(customerId: string, businessId: string): Promise<DbStoreCreditAccount | null>;
  createStoreCreditTransaction(t: Omit<DbStoreCreditTransaction, "id" | "createdAt">): Promise<DbStoreCreditTransaction>;
  listStoreCreditTransactions(accountId: string, businessId: string): Promise<DbStoreCreditTransaction[]>;
  findStoreCreditTransactionByIdempotency(businessId: string, idempotencyKey: string): Promise<DbStoreCreditTransaction | null>;
  upsertLoyaltyProgram(p: Omit<DbLoyaltyProgram, "id" | "updatedAt">): Promise<DbLoyaltyProgram>;
  getLoyaltyProgram(businessId: string): Promise<DbLoyaltyProgram | null>;
  createLoyaltyAccount(a: Omit<DbLoyaltyAccount, "id" | "createdAt" | "updatedAt">): Promise<DbLoyaltyAccount>;
  findLoyaltyAccount(customerId: string, businessId: string): Promise<DbLoyaltyAccount | null>;
  createLoyaltyTransaction(t: Omit<DbLoyaltyTransaction, "id" | "createdAt">): Promise<DbLoyaltyTransaction>;
  listLoyaltyTransactions(accountId: string, businessId: string): Promise<DbLoyaltyTransaction[]>;
  findLoyaltyTransactionByIdempotency(businessId: string, idempotencyKey: string): Promise<DbLoyaltyTransaction | null>;
  createSaleGiftCardLoad(l: Omit<DbSaleGiftCardLoad, "id" | "createdAt">): Promise<DbSaleGiftCardLoad>;
  updateSaleGiftCardLoad(id: string, businessId: string, patch: Partial<Pick<DbSaleGiftCardLoad, "giftCardId">>): Promise<DbSaleGiftCardLoad | null>;
  listSaleGiftCardLoads(saleId: string, businessId: string): Promise<DbSaleGiftCardLoad[]>;
  createSaleLoyalty(s: Omit<DbSaleLoyalty, "id" | "createdAt">): Promise<DbSaleLoyalty>;
  findSaleLoyalty(saleId: string, businessId: string): Promise<DbSaleLoyalty | null>;
  updateSaleLoyalty(id: string, businessId: string, patch: Partial<Pick<DbSaleLoyalty, "redeemedPoints" | "redeemedValueMinor" | "earnedPoints">>): Promise<DbSaleLoyalty | null>;
  createSaleItemLoyaltyAllocation(a: Omit<DbSaleItemLoyaltyAllocation, "id" | "createdAt">): Promise<DbSaleItemLoyaltyAllocation>;
  listSaleItemLoyaltyAllocations(saleLoyaltyId: string, businessId: string): Promise<DbSaleItemLoyaltyAllocation[]>;
  createRefund(r: Omit<DbRefund, "id">): Promise<DbRefund>;
  listRefundsBySale(saleId: string, businessId: string): Promise<DbRefund[]>;
  // Phase 12 bulk read: reporting maps refund items to sales in one round-trip.
  listRefundsByBusiness(businessId: string): Promise<DbRefund[]>;
  findRefundById(id: string, businessId: string): Promise<DbRefund | null>;
  createRefundItem(i: Omit<DbRefundItem, "id">): Promise<DbRefundItem>;
  listRefundItems(refundId: string, businessId: string): Promise<DbRefundItem[]>;
  listRefundItemsBySale(saleId: string, businessId: string): Promise<DbRefundItem[]>;
  // Phase 12 bulk read: reporting groups these by saleId in one round-trip.
  listRefundItemsByBusiness(businessId: string): Promise<DbRefundItem[]>;
  createExchange(e: Omit<DbExchange, "id" | "createdAt">): Promise<DbExchange>;
  findExchangeById(id: string, businessId: string): Promise<DbExchange | null>;
  listExchangesByOriginalSale(originalSaleId: string, businessId: string): Promise<DbExchange[]>;
  findExchangeByReplacementSale(replacementSaleId: string, businessId: string): Promise<DbExchange | null>;
  createExpense(e: Omit<DbExpense, "id">): Promise<DbExpense>;
  listExpensesByBusiness(businessId: string): Promise<DbExpense[]>;
  listExpensesPage(businessId: string, afterId: string | null, limit: number): Promise<DbExpense[]>;
  findExpenseById(id: string, businessId: string): Promise<DbExpense | null>;
  updateExpense(id: string, businessId: string, patch: Partial<Omit<DbExpense, "id" | "businessId">>): Promise<DbExpense | null>;
  createBranch(b: Omit<DbBranch, "id">): Promise<DbBranch>;
  listBranchesByBusiness(businessId: string): Promise<DbBranch[]>;
  findBranchById(id: string, businessId: string): Promise<DbBranch | null>;
  updateBranch(id: string, businessId: string, patch: Partial<Omit<DbBranch, "id" | "businessId">>): Promise<DbBranch | null>;
  createTransfer(t: Omit<DbStockTransfer, "id">): Promise<DbStockTransfer>;
  findTransferById(id: string, businessId: string): Promise<DbStockTransfer | null>;
  listTransfersByBusiness(businessId: string): Promise<DbStockTransfer[]>;
  updateTransfer(id: string, businessId: string, patch: Partial<Omit<DbStockTransfer, "id" | "businessId">>): Promise<DbStockTransfer | null>;
  createTransferLine(l: Omit<DbStockTransferLine, "id">): Promise<DbStockTransferLine>;
  listTransferLines(transferId: string, businessId: string): Promise<DbStockTransferLine[]>;
  createDevice(d: Omit<DbDevice, "id">): Promise<DbDevice>;
  listDevicesByBusiness(businessId: string): Promise<DbDevice[]>;
  findDeviceById(id: string, businessId: string): Promise<DbDevice | null>;
  revokeDevice(id: string, businessId: string, revokedAt: Date): Promise<DbDevice | null>;
  revokeSessionsByDevice(businessId: string, deviceId: string): Promise<void>;
  listMembershipsByBusiness(businessId: string): Promise<DbMembership[]>;
  // Cheap reads for high-frequency polling: latest row for a register instead
  // of loading the tenant's whole sales/shift history on every tick.
  findLatestSaleForRegister(businessId: string, registerId: string): Promise<DbSale | null>;
  hasShiftForRegister(businessId: string, registerId: string): Promise<boolean>;
  listPlans(): Promise<DbPlan[]>;
  findPlanByKey(key: string): Promise<DbPlan | null>;
  getSubscription(businessId: string): Promise<DbSubscription | null>;
  upsertSubscription(s: Omit<DbSubscription, "id" | "providerRef"> & { providerRef?: string | null }): Promise<DbSubscription>;
  updateSubscription(id: string, businessId: string, patch: Partial<Omit<DbSubscription, "id" | "businessId">>): Promise<DbSubscription | null>;
  listInvoices(businessId: string): Promise<DbInvoice[]>;
  createInvoice(i: Omit<DbInvoice, "id" | "issuedAt">): Promise<DbInvoice>;
  updateInvoice(id: string, businessId: string, patch: Partial<Omit<DbInvoice, "id" | "businessId">>): Promise<DbInvoice | null>;
  listCounters(businessId: string): Promise<DbUsageCounter[]>;
  setCounter(businessId: string, key: string, period: string, count: number): Promise<DbUsageCounter>;
  getFlag(businessId: string | null, key: string): Promise<DbFeatureFlag | null>;
  setFlag(f: { businessId: string | null; key: string; enabled: boolean }): Promise<DbFeatureFlag>;
  findWebhookEvent(provider: string, eventId: string): Promise<DbWebhookEvent | null>;
  createWebhookEvent(e: Omit<DbWebhookEvent, "id" | "receivedAt">): Promise<DbWebhookEvent>;
  // Atomic claim: the first caller for an eventId wins and gets true, every
  // concurrent redelivery gets false. Backed by the unique index on eventId.
  claimWebhookEvent(e: Omit<DbWebhookEvent, "id" | "receivedAt">): Promise<DbWebhookEvent | null>;
  updateWebhookEventStatus(id: string, status: string): Promise<void>;
  updateWebhookEventReceivedAt(id: string, receivedAt: Date): Promise<void>;
  deleteWebhookEvent(id: string): Promise<void>;
  createApiToken(t: Omit<DbApiToken, "id">): Promise<DbApiToken>;
  listApiTokens(businessId: string): Promise<DbApiToken[]>;
  findApiTokenByPrefix(prefix: string): Promise<DbApiToken | null>;
  // Prefixes are short, so a collision is possible: the guard verifies the full
  // hash against every candidate instead of trusting the first match.
  listApiTokensByPrefix(prefix: string): Promise<DbApiToken[]>;
  revokeApiToken(id: string, businessId: string, revokedAt: Date): Promise<DbApiToken | null>;
  createPrinter(p: Omit<DbPrinter, "id">): Promise<DbPrinter>;
  listPrinters(businessId: string): Promise<DbPrinter[]>;
  findPrinterById(id: string, businessId: string): Promise<DbPrinter | null>;
  findPrinterByAgentTokenHash(tokenHash: string): Promise<DbPrinter | null>;
  updatePrinter(id: string, businessId: string, patch: Partial<Omit<DbPrinter, "id" | "businessId">>): Promise<DbPrinter | null>;
  createPrintJob(j: Omit<DbPrintJob, "id">): Promise<DbPrintJob>;
  findPrintJobById(id: string, businessId: string): Promise<DbPrintJob | null>;
  listPrintJobs(businessId: string, status?: string): Promise<DbPrintJob[]>;
  updatePrintJob(id: string, businessId: string, patch: Partial<Omit<DbPrintJob, "id" | "businessId">>, expectedStatus?: string): Promise<DbPrintJob | null>;
  createDisplayToken(t: Omit<DbDisplayToken, "id">): Promise<DbDisplayToken>;
  findDisplayToken(tokenHash: string): Promise<DbDisplayToken | null>;
}
