// Phase 12 helper: compares every runtime Db* interface in db.port.ts against
// its Prisma model and reports fields the DDL cannot store. Optional runtime
// fields (foo?: T) may be absent from the DDL; required fields must exist.
import { readFileSync } from "node:fs";

const schema = readFileSync("packages/database/prisma/schema.prisma", "utf8");
const models = {};
for (const m of schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)) {
  const fields = {};
  for (const line of m[2].split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("//") || t.startsWith("@@")) continue;
    const parts = t.split(/\s+/);
    if (parts.length < 2) continue;
    fields[parts[0]] = { type: parts[1], optional: t.includes("?") };
  }
  models[m[1]] = fields;
}

const port = readFileSync("apps/api/src/common/db.port.ts", "utf8");
const MAP = {
  DbUser: "User", DbBusiness: "Business", DbMembership: "BusinessMembership",
  DbSession: "Session", DbResetToken: "PasswordResetToken",
  DbCategory: "Category", DbProduct: "Product", DbMovement: "InventoryMovement",
  DbBalance: "InventoryBalance", DbSale: "Sale", DbSaleItem: "SaleItem",
  DbPayment: "Payment", DbHeldSale: "HeldSale", DbIdempotency: "SaleIdempotency",
  DbRegister: "Register", DbShift: "Shift", DbCashMovement: "CashMovement",
  DbCustomer: "Customer", DbRefund: "Refund", DbRefundItem: "RefundItem",
  DbExpense: "Expense", DbBranch: "Branch", DbStockTransfer: "StockTransfer",
  DbStockTransferLine: "StockTransferLine", DbDevice: "Device",
  DbPlan: "Plan", DbSubscription: "Subscription", DbInvoice: "Invoice",
  DbUsageCounter: "UsageCounter", DbFeatureFlag: "FeatureFlag",
  DbWebhookEvent: "BillingWebhookEvent", DbApiToken: "ApiToken",
  DbPrinter: "PrinterDevice", DbPrintJob: "PrintJob", DbDisplayToken: "DisplayToken",
  DbShiftCorrection: "ShiftCorrection",
};

const gaps = [];
for (const [iface, model] of Object.entries(MAP)) {
  const im = port.match(new RegExp(`export interface ${iface} \\{([\\s\\S]*?)\\n\\}`));
  if (!im) { gaps.push(`${iface}: interface not found`); continue; }
  const pm = models[model];
  if (!pm) { gaps.push(`${iface} -> ${model}: model missing`); continue; }
  for (const line of im[1].split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("//") || t.startsWith("void ")) continue;
    const name = t.split(/[ ?:]/)[0];
    if (!name) continue;
    if (!(name in pm)) {
      gaps.push(`${iface}.${name} missing in ${model}${t.includes("?") ? " (optional — OK if the port defaults it)" : " (REQUIRED)"}`);
    }
  }
}
console.log(gaps.length ? gaps.join("\n") : "ALL PARITY OK");
