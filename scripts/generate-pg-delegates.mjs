// Phase 12 helper: generates PgDbPort delegate methods for the given family
// files by parsing the DbPort interface. Run: node scripts/generate-pg-delegates.mjs
import { readFileSync, writeFileSync } from "node:fs";

const FAMILIES = {
  catalog: ['createCategory','listCategories','findCategoryById','updateCategory','createProduct','listProducts','findProductById','updateProduct'],
  inventory: ['createMovement','listMovements','listMovementsByBusiness','listMovementsPage','upsertBalance','findBalance','listBalances'],
  devices: ['createDevice','listDevicesByBusiness','findDeviceById','revokeDevice','revokeSessionsByDevice'],
  billing: ['listPlans','findPlanByKey','getSubscription','upsertSubscription','updateSubscription','listInvoices','createInvoice','updateInvoice','listCounters','setCounter','getFlag','setFlag','findWebhookEvent','createWebhookEvent','claimWebhookEvent','updateWebhookEventStatus','updateWebhookEventReceivedAt','deleteWebhookEvent'],
  integrations: ['createApiToken','listApiTokens','findApiTokenByPrefix','listApiTokensByPrefix','revokeApiToken','createPrinter','listPrinters','findPrinterById','findPrinterByAgentTokenHash','createPrintJob','listPrintJobs','updatePrintJob','createDisplayToken','findDisplayToken','createSupportGrant','findValidSupportGrant','markSupportGrantUsed','createShiftCorrection','listShiftCorrections','createReceiptShare','findValidReceiptShare'],
  people: ['createCustomer','listCustomersByBusiness','findCustomerById','updateCustomer','createRefund','listRefundsBySale','listRefundsByBusiness','findRefundById','createRefundItem','listRefundItems','listRefundItemsBySale','listRefundItemsByBusiness','createExpense','listExpensesByBusiness','listExpensesPage','findExpenseById','updateExpense'],
  branches: ['createBranch','listBranchesByBusiness','findBranchById','updateBranch','createTransfer','findTransferById','listTransfersByBusiness','updateTransfer','createTransferLine','listTransferLines'],
  sales: ["createSale", "findSaleById", "listSalesByBusiness", "listSalesPage", "updateSale", "createSaleItem", "listSaleItems", "listSaleItemsByBusiness", "createPayment", "findPaymentById", "listPaymentsBySale", "updatePayment", "createHeldSale", "findHeldSaleById", "listHeldSales", "markHeldResumed", "claimIdempotency", "findIdempotency", "findLatestSaleForRegister", "nextReceiptNo"],
  shifts: ["createRegister", "listRegisters", "findRegisterById", "updateRegister", "createShift", "findShiftById", "findOpenShiftByRegister", "listShiftsByBusiness", "updateShift", "createCashMovement", "listCashMovementsByShift", "hasShiftForRegister"],
};

const port = readFileSync("apps/api/src/common/db.port.ts", "utf8").replace(/\r\n/g, "\n");
const iface = port.match(/export interface DbPort \{([\s\S]*?)\n\}/)[1];

const out = [];
const types = new Set();
for (const [family, methods] of Object.entries(FAMILIES)) {
  out.push(`  // ${family[0].toUpperCase()}${family.slice(1)} family.`);
  for (const m of methods) {
    const re = new RegExp(`  ${m}\\(([^)]*)\\): Promise<(.+)>;`);
    const match = iface.match(re);
    if (!match) {
      console.error(`MISSING: ${m}`);
      process.exit(1);
    }
    const [, args, ret] = match;
    for (const t of ret.match(/Db[A-Za-z]+/g) ?? []) types.add(t);
    // Split on top-level commas only (generic commas nest), then take each
    // segment's arg name (before its first colon).
    let depth = 0;
    const segments = [];
    let current = "";
    for (const ch of args) {
      if (ch === "<" || ch === "(") depth += 1;
      if (ch === ">" || ch === ")") depth -= 1;
      if (ch === "," && depth === 0) {
        segments.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    segments.push(current);
    const argList = segments
      .map((a) => a.slice(0, a.indexOf(":")).trim().replace(/\?$/, ""))
      .filter(Boolean)
      .join(", ");
    out.push(`  ${m}(${args}): Promise<${ret}> {`);
    out.push(`    return this.${family}.${m}(${argList});`);
    out.push(`  }`);
  }
}

writeFileSync("scripts/pg-delegates-snippet.txt", `${out.join("\n")}\n`);
console.log(`TYPES: ${[...types].join(", ")}`);
console.log(`wrote scripts/pg-delegates-snippet.txt (${out.length} lines)`);
