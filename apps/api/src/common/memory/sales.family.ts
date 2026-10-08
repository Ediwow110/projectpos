import type {
  DbPort,
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
} from "../db.port";
import type { MemoryState } from "./context";

export function createMemorySales(context: MemoryState): Pick<DbPort, "createSale" | "findSaleById" | "listSalesByBusiness" | "listSalesPage" | "updateSale" | "createSaleItem" | "listSaleItems" | "listSaleItemsByBusiness" | "createSaleItemBundleComponent" | "listSaleItemBundleComponents" | "createPayment" | "findPaymentById" | "listPaymentsBySale" | "listPaymentsByBusiness" | "updatePayment" | "createHeldSale" | "findHeldSaleById" | "listHeldSales" | "markHeldResumed" | "claimIdempotency" | "findIdempotency" | "nextReceiptNo" | "createRegister" | "listRegisters" | "findRegisterById" | "updateRegister" | "createShift" | "findShiftById" | "findOpenShiftByRegister" | "listShiftsByBusiness" | "updateShift" | "createCashMovement" | "listCashMovementsByShift" | "createCustomer" | "listCustomersByBusiness" | "findCustomerById" | "updateCustomer" | "createGiftCard" | "findGiftCardByHash" | "findGiftCardById" | "listGiftCards" | "updateGiftCard" | "createGiftCardTransaction" | "listGiftCardTransactions" | "findGiftCardTransactionByIdempotency" | "createStoreCreditAccount" | "findStoreCreditAccount" | "createStoreCreditTransaction" | "listStoreCreditTransactions" | "findStoreCreditTransactionByIdempotency" | "upsertLoyaltyProgram" | "getLoyaltyProgram" | "createLoyaltyAccount" | "findLoyaltyAccount" | "createLoyaltyTransaction" | "listLoyaltyTransactions" | "findLoyaltyTransactionByIdempotency" | "createSaleGiftCardLoad" | "updateSaleGiftCardLoad" | "listSaleGiftCardLoads" | "createSaleLoyalty" | "findSaleLoyalty" | "updateSaleLoyalty" | "createSaleItemLoyaltyAllocation" | "listSaleItemLoyaltyAllocations" | "createRefund" | "listRefundsByBusiness" | "listRefundsBySale" | "findRefundById" | "createRefundItem" | "listRefundItems" | "listRefundItemsBySale" | "listRefundItemsByBusiness" | "createExchange" | "findExchangeById" | "listExchangesByOriginalSale" | "findExchangeByReplacementSale" | "createExpense" | "listExpensesByBusiness" | "listExpensesPage" | "findExpenseById" | "updateExpense" | "createBranch" | "listBranchesByBusiness" | "findBranchById" | "updateBranch" | "createTransfer" | "findTransferById" | "listTransfersByBusiness" | "updateTransfer" | "createTransferLine" | "listTransferLines" | "createDevice" | "listDevicesByBusiness" | "findDeviceById" | "revokeDevice" | "revokeSessionsByDevice" | "listPlans" | "findPlanByKey" | "getSubscription" | "upsertSubscription" | "updateSubscription" | "listInvoices" | "createInvoice" | "updateInvoice" | "listCounters" | "setCounter" | "getFlag" | "setFlag" | "findWebhookEvent" | "createWebhookEvent" | "claimWebhookEvent" | "updateWebhookEventStatus" | "updateWebhookEventReceivedAt" | "deleteWebhookEvent" | "createApiToken" | "listApiTokens" | "findApiTokenByPrefix" | "listApiTokensByPrefix" | "revokeApiToken" | "createPrinter" | "listPrinters" | "findPrinterById" | "findPrinterByAgentTokenHash" | "updatePrinter" | "createPrintJob" | "findPrintJobById" | "listPrintJobs" | "updatePrintJob" | "createDisplayToken" | "findDisplayToken"> {
  const {
    sessions,
    saleItemBundleComponents,
    sales,
    saleItems,
    payments,
    heldSales,
    idempotency,
    purchaseReceiptSeq,
    registers,
    shifts,
    cashMovements,
    customers,
    giftCards,
    giftCardTransactions,
    storeCreditAccounts,
    storeCreditTransactions,
    loyaltyPrograms,
    loyaltyAccounts,
    loyaltyTransactions,
    saleGiftCardLoads,
    saleLoyalty,
    saleItemLoyaltyAllocations,
    refunds,
    refundItems,
    exchanges,
    expenses,
    branches,
    transfers,
    transferLines,
    devices,
    plans,
    subscriptions,
    invoices,
    counters,
    flags,
    webhookEvents,
    apiTokens,
    printers,
    printJobs,
    displayTokens,
    nextId: nid,
  } = context;

  // Unambiguous tuple encoding mirrors PostgreSQL's composite unique key.
  const idempotencyMapKey = (businessId: string, key: string, commandType: string): string =>
    JSON.stringify([businessId, key, commandType]);

  return {
    async createSale(s) {
      const row = { completedAt: null, ...s, id: nid("sale") };
      sales.set(row.id, row);
      return row;
    },
    async findSaleById(id, businessId) {
      const s = sales.get(id) ?? null;
      if (!s || s.businessId !== businessId) return null;
      return s;
    },
    async listSalesByBusiness(businessId) {
      return [...sales.values()].filter((s) => s.businessId === businessId);
    },
    async listSalesPage(businessId, afterId, limit) {
      const rows = [...sales.values()]
        .filter((s) => s.businessId === businessId && (afterId === null || s.id > afterId))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return rows.slice(0, limit);
    },
    async updateSale(id, businessId, patch) {
      const s = sales.get(id) ?? null;
      if (!s || s.businessId !== businessId) return null;
      const next = { ...s, ...patch };
      sales.set(id, next);
      return next;
    },
    async createSaleItem(i) {
      const nextPosition =
        i.position ??
        [...saleItems.values()].filter(
          (item) => item.saleId === i.saleId && item.businessId === i.businessId,
        ).length;
      const row = { ...i, position: nextPosition, id: nid("sitem") };
      saleItems.set(row.id, row);
      return row;
    },
    async listSaleItems(saleId, businessId) {
      return [...saleItems.values()]
        .filter((i) => i.saleId === saleId && i.businessId === businessId)
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    },
    async listSaleItemsByBusiness(businessId) {
      return [...saleItems.values()].filter((i) => i.businessId === businessId);
    },
    async createSaleItemBundleComponent(c) { const row = { ...c, id: nid("sbc"), createdAt: new Date() }; saleItemBundleComponents.set(row.id, row); return row; },
    async listSaleItemBundleComponents(saleItemId, businessId) { return [...saleItemBundleComponents.values()].filter((r) => r.saleItemId === saleItemId && r.businessId === businessId); },
    async createPayment(p) {
      const row = { internalInstrumentType: null, internalInstrumentId: null, ...p, id: nid("pay") };
      payments.set(row.id, row);
      return row;
    },
    async findPaymentById(id, businessId) {
      const p = payments.get(id) ?? null;
      if (!p || p.businessId !== businessId) return null;
      return p;
    },
    async listPaymentsBySale(saleId, businessId) {
      return [...payments.values()].filter(
        (p) => p.saleId === saleId && p.businessId === businessId,
      );
    },
    async listPaymentsByBusiness(businessId) {
      return [...payments.values()].filter((p) => p.businessId === businessId);
    },
    async updatePayment(id, businessId, patch) {
      const p = payments.get(id) ?? null;
      if (!p || p.businessId !== businessId) return null;
      const next = { ...p, ...patch };
      payments.set(id, next);
      return next;
    },
    async createHeldSale(h) {
      const row = { ...h, id: nid("held") };
      heldSales.set(row.id, row);
      return row;
    },
    async findHeldSaleById(id, businessId) {
      const h = heldSales.get(id) ?? null;
      if (!h || h.businessId !== businessId) return null;
      return h;
    },
    async listHeldSales(businessId, actorId) {
      return [...heldSales.values()].filter(
        (h) => h.businessId === businessId && h.actorId === actorId,
      );
    },
    async markHeldResumed(id, businessId) {
      const h = heldSales.get(id);
      if (h && h.businessId === businessId) heldSales.set(id, { ...h, resumedAt: new Date() });
    },
    async claimIdempotency(r) {
      const key = idempotencyMapKey(r.businessId, r.key, r.commandType);
      if (idempotency.has(key)) throw new Error("IDEMPOTENCY_REPLAY");
      idempotency.set(key, r);
    },
    async findIdempotency(businessId, key, commandType) {
      return idempotency.get(idempotencyMapKey(businessId, key, commandType)) ?? null;
    },
    async nextReceiptNo(businessId) {
      const year = new Date().getUTCFullYear();
      const seq = (purchaseReceiptSeq.get(businessId) ?? 0) + 1;
      purchaseReceiptSeq.set(businessId, seq);
      return `${year}-${String(seq).padStart(6, "0")}`;
    },
    async createRegister(r) {
      const row = { ...r, id: nid("reg") };
      registers.set(row.id, row);
      return row;
    },
    async listRegisters(businessId) {
      return [...registers.values()].filter((r) => r.businessId === businessId);
    },
    async findRegisterById(id, businessId) {
      const r = registers.get(id) ?? null;
      if (!r || r.businessId !== businessId) return null;
      return r;
    },
    async updateRegister(id, businessId, patch) {
      const r = registers.get(id) ?? null;
      if (!r || r.businessId !== businessId) return null;
      const next = { ...r, ...patch };
      registers.set(id, next);
      return next;
    },
    async createShift(s) {
      const row = { ...s, id: nid("shift") };
      shifts.set(row.id, row);
      return row;
    },
    async findShiftById(id, businessId) {
      const s = shifts.get(id) ?? null;
      if (!s || s.businessId !== businessId) return null;
      return s;
    },
    async findOpenShiftByRegister(businessId, registerId) {
      for (const s of shifts.values()) {
        if (s.businessId === businessId && s.registerId === registerId && s.status === "OPEN") return s;
      }
      return null;
    },
    async listShiftsByBusiness(businessId) {
      return [...shifts.values()].filter((s) => s.businessId === businessId);
    },
    async updateShift(id, businessId, patch) {
      const s = shifts.get(id) ?? null;
      if (!s || s.businessId !== businessId) return null;
      const next = { ...s, ...patch };
      shifts.set(id, next);
      return next;
    },
    async createCashMovement(m) {
      const row = { ...m, id: nid("cmov") };
      cashMovements.set(row.id, row);
      return row;
    },
    async listCashMovementsByShift(shiftId, businessId) {
      return [...cashMovements.values()].filter(
        (m) => m.shiftId === shiftId && m.businessId === businessId,
      );
    },
    async createCustomer(c) {
      const row = { ...c, id: nid("cust") };
      customers.set(row.id, row);
      return row;
    },
    async listCustomersByBusiness(businessId) {
      return [...customers.values()].filter((c) => c.businessId === businessId);
    },
    async findCustomerById(id, businessId) {
      const c = customers.get(id) ?? null;
      if (!c || c.businessId !== businessId) return null;
      return c;
    },
    async updateCustomer(id, businessId, patch) {
      const c = customers.get(id) ?? null;
      if (!c || c.businessId !== businessId) return null;
      const next = { ...c, ...patch };
      customers.set(id, next);
      return next;
    },
    async createGiftCard(c) {
      if ([...giftCards.values()].some((row) => row.businessId === c.businessId && row.codeHash === c.codeHash)) throw new Error("GIFT_CARD_DUPLICATE");
      const now = new Date();
      const row: DbGiftCard = { ...c, id: nid("gcard"), createdAt: now, updatedAt: now };
      giftCards.set(row.id, row);
      return row;
    },
    async findGiftCardByHash(codeHash, businessId) {
      return [...giftCards.values()].find((row) => row.businessId === businessId && row.codeHash === codeHash) ?? null;
    },
    async findGiftCardById(id, businessId) {
      const row = giftCards.get(id) ?? null;
      return row && row.businessId === businessId ? row : null;
    },
    async listGiftCards(businessId) {
      return [...giftCards.values()].filter((row) => row.businessId === businessId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async updateGiftCard(id, businessId, patch) {
      const row = giftCards.get(id) ?? null;
      if (!row || row.businessId !== businessId) return null;
      const next = { ...row, ...patch, updatedAt: new Date() };
      giftCards.set(id, next);
      return next;
    },
    async createGiftCardTransaction(t) {
      const existing = [...giftCardTransactions.values()].find((row) => row.businessId === t.businessId && row.idempotencyKey === t.idempotencyKey);
      if (existing) return existing;
      const card = giftCards.get(t.giftCardId);
      if (!card || card.businessId !== t.businessId) throw new Error("NOT_FOUND");
      const balance = [...giftCardTransactions.values()].filter((row) => row.businessId === t.businessId && row.giftCardId === t.giftCardId).reduce((sum, row) => sum + row.amountDeltaMinor, 0);
      if (balance + t.amountDeltaMinor < 0) throw new Error("GIFT_CARD_INSUFFICIENT_BALANCE");
      const row: DbGiftCardTransaction = { ...t, id: nid("gct"), createdAt: new Date() };
      giftCardTransactions.set(row.id, row);
      if (balance + t.amountDeltaMinor === 0 && card.status === "ACTIVE") await this.updateGiftCard(card.id, card.businessId, { status: "EXHAUSTED" });
      if (balance + t.amountDeltaMinor > 0 && card.status === "EXHAUSTED") await this.updateGiftCard(card.id, card.businessId, { status: "ACTIVE" });
      return row;
    },
    async listGiftCardTransactions(giftCardId, businessId) {
      return [...giftCardTransactions.values()].filter((row) => row.giftCardId === giftCardId && row.businessId === businessId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },
    async findGiftCardTransactionByIdempotency(businessId, idempotencyKey) {
      return [...giftCardTransactions.values()].find((row) => row.businessId === businessId && row.idempotencyKey === idempotencyKey) ?? null;
    },
    async createStoreCreditAccount(a) {
      const existing = [...storeCreditAccounts.values()].find((row) => row.businessId === a.businessId && row.customerId === a.customerId);
      if (existing) return existing;
      const row: DbStoreCreditAccount = { ...a, id: nid("sca"), createdAt: new Date(), updatedAt: new Date() };
      storeCreditAccounts.set(row.id, row);
      return row;
    },
    async findStoreCreditAccount(customerId, businessId) {
      return [...storeCreditAccounts.values()].find((row) => row.businessId === businessId && row.customerId === customerId) ?? null;
    },
    async createStoreCreditTransaction(t) {
      const existing = [...storeCreditTransactions.values()].find((row) => row.businessId === t.businessId && row.idempotencyKey === t.idempotencyKey);
      if (existing) return existing;
      const account = storeCreditAccounts.get(t.accountId);
      if (!account || account.businessId !== t.businessId || account.customerId !== t.customerId) throw new Error("NOT_FOUND");
      const balance = [...storeCreditTransactions.values()].filter((row) => row.businessId === t.businessId && row.accountId === t.accountId).reduce((sum, row) => sum + row.amountDeltaMinor, 0);
      if (balance + t.amountDeltaMinor < 0) throw new Error("STORE_CREDIT_INSUFFICIENT_BALANCE");
      const row: DbStoreCreditTransaction = { ...t, id: nid("sct"), createdAt: new Date() };
      storeCreditTransactions.set(row.id, row);
      return row;
    },
    async listStoreCreditTransactions(accountId, businessId) {
      return [...storeCreditTransactions.values()].filter((row) => row.accountId === accountId && row.businessId === businessId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },
    async findStoreCreditTransactionByIdempotency(businessId, idempotencyKey) {
      return [...storeCreditTransactions.values()].find((row) => row.businessId === businessId && row.idempotencyKey === idempotencyKey) ?? null;
    },
    async upsertLoyaltyProgram(p) {
      const existing = loyaltyPrograms.get(p.businessId);
      const row: DbLoyaltyProgram = existing ? { ...existing, ...p, version: existing.version + 1, updatedAt: new Date() } : { ...p, id: nid("lp"), updatedAt: new Date() };
      loyaltyPrograms.set(p.businessId, row);
      return row;
    },
    async getLoyaltyProgram(businessId) { return loyaltyPrograms.get(businessId) ?? null; },
    async createLoyaltyAccount(a) {
      const existing = [...loyaltyAccounts.values()].find((row) => row.businessId === a.businessId && row.customerId === a.customerId);
      if (existing) return existing;
      const row: DbLoyaltyAccount = { ...a, id: nid("la"), createdAt: new Date(), updatedAt: new Date() };
      loyaltyAccounts.set(row.id, row);
      return row;
    },
    async findLoyaltyAccount(customerId, businessId) { return [...loyaltyAccounts.values()].find((row) => row.businessId === businessId && row.customerId === customerId) ?? null; },
    async createLoyaltyTransaction(t) {
      const existing = [...loyaltyTransactions.values()].find((row) => row.businessId === t.businessId && row.idempotencyKey === t.idempotencyKey);
      if (existing) return existing;
      const account = loyaltyAccounts.get(t.accountId);
      if (!account || account.businessId !== t.businessId || account.customerId !== t.customerId) throw new Error("NOT_FOUND");
      const balance = [...loyaltyTransactions.values()].filter((row) => row.businessId === t.businessId && row.accountId === t.accountId).reduce((sum, row) => sum + row.pointsDelta, 0);
      if (balance + t.pointsDelta < 0 && !t.type.startsWith("REFUND_EARN")) throw new Error("LOYALTY_INSUFFICIENT_POINTS");
      const row: DbLoyaltyTransaction = { ...t, id: nid("lt"), createdAt: new Date() };
      loyaltyTransactions.set(row.id, row);
      return row;
    },
    async listLoyaltyTransactions(accountId, businessId) { return [...loyaltyTransactions.values()].filter((row) => row.accountId === accountId && row.businessId === businessId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()); },
    async findLoyaltyTransactionByIdempotency(businessId, idempotencyKey) { return [...loyaltyTransactions.values()].find((row) => row.businessId === businessId && row.idempotencyKey === idempotencyKey) ?? null; },
    async createSaleGiftCardLoad(l) { const row: DbSaleGiftCardLoad = { ...l, id: nid("sgl"), createdAt: new Date() }; saleGiftCardLoads.set(row.id, row); return row; },
    async updateSaleGiftCardLoad(id, businessId, patch) { const row = saleGiftCardLoads.get(id); if (!row || row.businessId !== businessId) return null; const updated = { ...row, ...patch }; saleGiftCardLoads.set(id, updated); return updated; },
    async listSaleGiftCardLoads(saleId, businessId) { return [...saleGiftCardLoads.values()].filter((row) => row.saleId === saleId && row.businessId === businessId); },
    async createSaleLoyalty(s) { const row: DbSaleLoyalty = { ...s, id: nid("sl"), createdAt: new Date() }; saleLoyalty.set(row.saleId, row); return row; },
    async findSaleLoyalty(saleId, businessId) { const row = saleLoyalty.get(saleId) ?? null; return row && row.businessId === businessId ? row : null; },
    async updateSaleLoyalty(id, businessId, patch) { const row = saleLoyalty.get(id); if (!row || row.businessId !== businessId) return null; const updated = { ...row, ...patch }; saleLoyalty.set(id, updated); return updated; },
    async createSaleItemLoyaltyAllocation(a) { const row: DbSaleItemLoyaltyAllocation = { ...a, id: nid("sla"), createdAt: new Date() }; saleItemLoyaltyAllocations.set(row.id, row); return row; },
    async listSaleItemLoyaltyAllocations(saleLoyaltyId, businessId) { return [...saleItemLoyaltyAllocations.values()].filter((row) => row.saleLoyaltyId === saleLoyaltyId && row.businessId === businessId); },
    async createRefund(r) {
      const row = { ...r, id: nid("ref") };
      refunds.set(row.id, row);
      return row;
    },
    async listRefundsByBusiness(businessId) {
      return [...refunds.values()].filter((r) => r.businessId === businessId);
    },
    async listRefundsBySale(saleId, businessId) {
      return [...refunds.values()].filter(
        (r) => r.saleId === saleId && r.businessId === businessId,
      );
    },
    async findRefundById(id, businessId) {
      const r = refunds.get(id) ?? null;
      if (!r || r.businessId !== businessId) return null;
      return r;
    },
    async createRefundItem(i) {
      const row = { ...i, id: nid("ritem") };
      refundItems.set(row.id, row);
      return row;
    },
    async listRefundItems(refundId, businessId) {
      return [...refundItems.values()].filter(
        (i) => i.refundId === refundId && i.businessId === businessId,
      );
    },
    async listRefundItemsBySale(saleId, businessId) {
      const ids = new Set(
        [...refunds.values()]
          .filter((r) => r.saleId === saleId && r.businessId === businessId)
          .map((r) => r.id),
      );
      return [...refundItems.values()].filter(
        (i) => ids.has(i.refundId) && i.businessId === businessId,
      );
    },
    async listRefundItemsByBusiness(businessId) {
      return [...refundItems.values()].filter((i) => i.businessId === businessId);
    },
    async createExchange(e) {
      const row = { ...e, id: nid("exch"), createdAt: new Date() };
      exchanges.set(row.id, row);
      return row;
    },
    async findExchangeById(id, businessId) {
      const row = exchanges.get(id) ?? null;
      if (!row || row.businessId !== businessId) return null;
      return row;
    },
    async listExchangesByOriginalSale(originalSaleId, businessId) {
      return [...exchanges.values()]
        .filter((row) => row.businessId === businessId && row.originalSaleId === originalSaleId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },
    async findExchangeByReplacementSale(replacementSaleId, businessId) {
      return [...exchanges.values()].find(
        (row) => row.businessId === businessId && row.replacementSaleId === replacementSaleId,
      ) ?? null;
    },
    async createExpense(e) {
      const row = { ...e, id: nid("exp") };
      expenses.set(row.id, row);
      return row;
    },
    async listExpensesByBusiness(businessId) {
      return [...expenses.values()].filter((e) => e.businessId === businessId);
    },
    async listExpensesPage(businessId, afterId, limit) {
      const rows = [...expenses.values()]
        .filter((e) => e.businessId === businessId && (afterId === null || e.id > afterId))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return rows.slice(0, limit);
    },
    async findExpenseById(id, businessId) {
      const e = expenses.get(id) ?? null;
      if (!e || e.businessId !== businessId) return null;
      return e;
    },
    async updateExpense(id, businessId, patch) {
      const e = expenses.get(id) ?? null;
      if (!e || e.businessId !== businessId) return null;
      const next = { ...e, ...patch };
      expenses.set(id, next);
      return next;
    },
    async createBranch(b) {
      const row = { ...b, id: nid("br") };
      branches.set(row.id, row);
      return row;
    },
    async listBranchesByBusiness(businessId) {
      return [...branches.values()]
        .filter((b) => b.businessId === businessId)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async findBranchById(id, businessId) {
      const b = branches.get(id) ?? null;
      if (!b || b.businessId !== businessId) return null;
      return b;
    },
    async updateBranch(id, businessId, patch) {
      const b = branches.get(id) ?? null;
      if (!b || b.businessId !== businessId) return null;
      const next = { ...b, ...patch };
      branches.set(id, next);
      return next;
    },
    async createTransfer(t) {
      const row = { ...t, id: nid("trx") };
      transfers.set(row.id, row);
      return row;
    },
    async findTransferById(id, businessId) {
      const t = transfers.get(id) ?? null;
      if (!t || t.businessId !== businessId) return null;
      return t;
    },
    async listTransfersByBusiness(businessId) {
      return [...transfers.values()].filter((t) => t.businessId === businessId);
    },
    async updateTransfer(id, businessId, patch) {
      const t = transfers.get(id) ?? null;
      if (!t || t.businessId !== businessId) return null;
      const next = { ...t, ...patch };
      transfers.set(id, next);
      return next;
    },
    async createTransferLine(l) {
      const row = { ...l, id: nid("tline") };
      transferLines.set(row.id, row);
      return row;
    },
    async listTransferLines(transferId, businessId) {
      return [...transferLines.values()].filter(
        (l) => l.transferId === transferId && l.businessId === businessId,
      );
    },
    async createDevice(d) {
      const row = { ...d, id: nid("dev") };
      devices.set(row.id, row);
      return row;
    },
    async listDevicesByBusiness(businessId) {
      return [...devices.values()].filter((d) => d.businessId === businessId);
    },
    async findDeviceById(id, businessId) {
      const d = devices.get(id) ?? null;
      if (!d || d.businessId !== businessId) return null;
      return d;
    },
    async revokeDevice(id, businessId, revokedAt) {
      const d = devices.get(id) ?? null;
      if (!d || d.businessId !== businessId) return null;
      const next = { ...d, revokedAt };
      devices.set(id, next);
      return next;
    },
    async revokeSessionsByDevice(businessId, deviceId) {
      for (const s of sessions.values()) {
        if (s.businessId === businessId && s.deviceId === deviceId && s.revokedAt === null) {
          sessions.set(s.id, { ...s, revokedAt: new Date() });
        }
      }
    },
    async listPlans() {
      return [...plans.values()];
    },
    async findPlanByKey(key) {
      for (const p of plans.values()) if (p.key === key) return p;
      return null;
    },
    async getSubscription(businessId) {
      for (const s of subscriptions.values()) if (s.businessId === businessId) return s;
      return null;
    },
    async upsertSubscription(s) {
      let existing = null;
      for (const cur of subscriptions.values()) {
        if (cur.businessId === s.businessId) { existing = cur; break; }
      }
      const row = existing
        ? { ...existing, ...s, id: existing.id, providerRef: s.providerRef ?? existing.providerRef }
        : { ...s, id: nid("sub"), providerRef: s.providerRef ?? null };
      subscriptions.set(row.id, row);
      return row;
    },
    async updateSubscription(id, businessId, patch) {
      const s = subscriptions.get(id) ?? null;
      if (!s || s.businessId !== businessId) return null;
      const next = { ...s, ...patch };
      subscriptions.set(id, next);
      return next;
    },
    async listInvoices(businessId) {
      return [...invoices.values()].filter((i) => i.businessId === businessId);
    },
    async createInvoice(i) {
      const row = { ...i, id: nid("inv"), issuedAt: new Date() };
      invoices.set(row.id, row);
      return row;
    },
    async updateInvoice(id, businessId, patch) {
      const i = invoices.get(id) ?? null;
      if (!i || i.businessId !== businessId) return null;
      const next = { ...i, ...patch };
      invoices.set(id, next);
      return next;
    },
    async listCounters(businessId) {
      return [...counters.values()].filter((c) => c.businessId === businessId);
    },
    async setCounter(businessId, key, period, count) {
      const id = `${businessId}:${key}:${period}`;
      const row = { id, businessId, key, period, count };
      counters.set(id, row);
      return row;
    },
    async getFlag(businessId, key) {
      for (const f of flags.values()) {
        if ((f.businessId ?? null) === (businessId ?? null) && f.key === key) return f;
      }
      return null;
    },
    async setFlag(f) {
      const { businessId, key, enabled } = f;
      let existing = null;
      for (const cur of flags.values()) {
        if ((cur.businessId ?? null) === (businessId ?? null) && cur.key === key) { existing = cur; break; }
      }
      const row = existing ? { ...existing, enabled } : { id: nid("flag"), businessId, key, enabled };
      flags.set(row.id, row);
      return row;
    },
    async findWebhookEvent(provider, eventId) {
      for (const e of webhookEvents.values()) {
        if (e.provider === provider && e.eventId === eventId) return e;
      }
      return null;
    },
    async createWebhookEvent(e) {
      const row = { ...e, id: nid("whev"), receivedAt: new Date() };
      webhookEvents.set(row.id, row);
      return row;
    },
    async claimWebhookEvent(e) {
      for (const existing of webhookEvents.values()) {
        if (existing.provider === e.provider && existing.eventId === e.eventId) return null;
      }
      const row = { ...e, id: nid("whev"), receivedAt: new Date() };
      webhookEvents.set(row.id, row);
      return row;
    },
    async updateWebhookEventStatus(id, status) {
      const row = webhookEvents.get(id);
      if (row) webhookEvents.set(id, { ...row, status });
    },
    async updateWebhookEventReceivedAt(id, receivedAt) {
      const row = webhookEvents.get(id);
      if (row) webhookEvents.set(id, { ...row, receivedAt });
    },
    async deleteWebhookEvent(id) {
      webhookEvents.delete(id);
    },
    async createApiToken(t) {
      const row = { ...t, id: nid("tok") };
      apiTokens.set(row.id, row);
      return row;
    },
    async listApiTokens(businessId) {
      return [...apiTokens.values()].filter((t) => t.businessId === businessId);
    },
    async findApiTokenByPrefix(prefix) {
      for (const t of apiTokens.values()) if (t.prefix === prefix) return t;
      return null;
    },
    async listApiTokensByPrefix(prefix) {
      return [...apiTokens.values()].filter((t) => t.prefix === prefix);
    },
    async revokeApiToken(id, businessId, revokedAt) {
      const t = apiTokens.get(id) ?? null;
      if (!t || t.businessId !== businessId) return null;
      const next = { ...t, revokedAt };
      apiTokens.set(id, next);
      return next;
    },
    async createPrinter(p) {
      const row = { ...p, id: nid("prt") };
      printers.set(row.id, row);
      return row;
    },
    async listPrinters(businessId) {
      return [...printers.values()].filter((p) => p.businessId === businessId);
    },
    async findPrinterById(id, businessId) {
      const p = printers.get(id) ?? null;
      if (!p || p.businessId !== businessId) return null;
      return p;
    },
    async findPrinterByAgentTokenHash(tokenHash) {
      for (const p of printers.values()) {
        if (p.agentTokenHash !== null && p.agentTokenHash === tokenHash) return p;
      }
      return null;
    },
    async updatePrinter(id, businessId, patch) {
      const p = printers.get(id) ?? null;
      if (!p || p.businessId !== businessId) return null;
      const next = { ...p, ...patch };
      printers.set(id, next);
      return next;
    },
    async createPrintJob(j) {
      const row = { ...j, id: nid("pjob") };
      printJobs.set(row.id, row);
      return row;
    },
    async findPrintJobById(id, businessId) {
      const job = printJobs.get(id) ?? null;
      if (!job || job.businessId !== businessId) return null;
      return job;
    },
    async listPrintJobs(businessId, status) {
      return [...printJobs.values()].filter(
        (j) => j.businessId === businessId && (status === undefined || j.status === status),
      );
    },
    async updatePrintJob(id, businessId, patch, expectedStatus) {
      const j = printJobs.get(id) ?? null;
      if (!j || j.businessId !== businessId) return null;
      if (expectedStatus !== undefined && j.status !== expectedStatus) return null;
      const next = { ...j, ...patch };
      printJobs.set(id, next);
      return next;
    },
    async createDisplayToken(t) {
      const row = { ...t, id: nid("dtok") };
      displayTokens.set(row.id, row);
      return row;
    },
    async findDisplayToken(tokenHash) {
      for (const t of displayTokens.values()) if (t.tokenHash === tokenHash) return t;
      return null;
    },

    // Phase 16: procurement. Commercial records only — these stores never
    // touch movements/balances, mirroring the service-level invariant.
  };
}
