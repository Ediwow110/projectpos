// Phase 12 helper: generates PgDbPort delegate methods for the given family
// files by parsing the DbPort interface. Run: node scripts/generate-pg-delegates.mjs
import { readFileSync, writeFileSync } from "node:fs";

const FAMILIES = {
  people: ['createCustomer','listCustomersByBusiness','findCustomerById','updateCustomer','createRefund','listRefundsBySale','findRefundById','createRefundItem','listRefundItems','listRefundItemsBySale','createExpense','listExpensesByBusiness','listExpensesPage','findExpenseById','updateExpense'],
  branches: ['createBranch','listBranchesByBusiness','findBranchById','updateBranch','createTransfer','findTransferById','listTransfersByBusiness','updateTransfer','createTransferLine','listTransferLines'],
  sales: ["createSale", "findSaleById", "listSalesByBusiness", "listSalesPage", "updateSale", "createSaleItem", "listSaleItems", "createPayment", "findPaymentById", "listPaymentsBySale", "updatePayment", "createHeldSale", "findHeldSaleById", "listHeldSales", "markHeldResumed", "claimIdempotency", "findIdempotency", "findLatestSaleForRegister"],
  shifts: ["createRegister", "listRegisters", "findRegisterById", "updateRegister", "createShift", "findShiftById", "findOpenShiftByRegister", "listShiftsByBusiness", "updateShift", "createCashMovement", "listCashMovementsByShift", "hasShiftForRegister"],
};

const port = readFileSync("apps/api/src/common/db.port.ts", "utf8");
const iface = port.match(/export interface DbPort \{([\s\S]*?)\n\}/)[1];

const out = [];
const types = new Set();
for (const [family, methods] of Object.entries(FAMILIES)) {
  out.push(`  // ${family[0].toUpperCase()}${family.slice(1)} family.`);
  for (const m of methods) {
    const re = new RegExp(`  ${m}\\(([^)]*)\\): Promise<([^;]+)>;`);
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
      .map((a) => a.slice(0, a.indexOf(":")).trim())
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
