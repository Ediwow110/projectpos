import type {
  DbGiftCard,
  DbGiftCardTransaction,
  DbLoyaltyAccount,
  DbLoyaltyProgram,
  DbLoyaltyTransaction,
  DbSaleGiftCardLoad,
  DbSaleItemLoyaltyAllocation,
  DbSaleLoyalty,
  DbStoreCreditAccount,
  DbStoreCreditTransaction,
} from "../db.port";
import { nid } from "./context";
import type { PgContext } from "./context";

function buildSet(patch: Record<string, unknown>): { sets: string[]; values: unknown[] } {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    values.push(value);
    sets.push(`"${key}" = $${values.length}`);
  }
  return { sets, values };
}

const GC = '"id", "businessId", "codeHash", "codePrefix", "codeLast4", "status", "createdBy", "activatedAt", "suspendedAt", "version", "createdAt", "updatedAt"';
const GCT = '"id", "businessId", "giftCardId", "type", "amountDeltaMinor", "saleId", "refundId", "loadId", "actorId", "requestId", "idempotencyKey", "reason", "branchId", "createdAt"';
const SCA = '"id", "businessId", "customerId", "createdAt", "updatedAt"';
const SCT = '"id", "businessId", "accountId", "customerId", "type", "amountDeltaMinor", "saleId", "refundId", "actorId", "requestId", "idempotencyKey", "reason", "branchId", "createdAt"';
const LP = '"id", "businessId", "enabled", "earnAmountMinor", "earnPoints", "redeemPoints", "redeemValueMinor", "minimumRedeemPoints", "version", "updatedAt"';
const LA = '"id", "businessId", "customerId", "createdAt", "updatedAt"';
const LT = '"id", "businessId", "accountId", "customerId", "type", "pointsDelta", "valueMinorSnapshot", "saleId", "refundId", "actorId", "requestId", "idempotencyKey", "reason", "createdAt"';
const SGL = '"id", "businessId", "saleId", "giftCardId", "amountMinor", "kind", "createdAt"';
const SL = '"id", "businessId", "saleId", "customerId", "loyaltyAccountId", "programVersion", "eligibleSpendMinor", "earnedPoints", "redeemedPoints", "redeemedValueMinor", "earnAmountMinorSnapshot", "earnPointsSnapshot", "redeemPointsSnapshot", "redeemValueMinorSnapshot", "createdAt"';
const SLA = '"id", "businessId", "saleLoyaltyId", "saleItemId", "earnedPoints", "createdAt"';

export function valueFamily(ctx: PgContext) {
  async function balance(table: string, column: string, idColumn: string, id: string, businessId: string): Promise<number> {
    const c = await ctx.client();
    try {
      const r = await c.query(`SELECT COALESCE(SUM("amountDeltaMinor"), 0) AS "balance" FROM "${table}" WHERE "businessId" = $1 AND "${idColumn}" = $2`, [businessId, id]);
      return Number(r.rows[0]?.balance ?? 0);
    } finally { if (ctx.owns()) c.release(); }
  }
  return {
    async createGiftCard(input: Omit<DbGiftCard, "id" | "createdAt" | "updatedAt">): Promise<DbGiftCard> {
      const c = await ctx.client();
      try {
        const row = { ...input, id: nid("gcard") };
        await c.query(`INSERT INTO "GiftCard" ("id", "businessId", "codeHash", "codePrefix", "codeLast4", "status", "createdBy", "activatedAt", "suspendedAt", "version") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [row.id,row.businessId,row.codeHash,row.codePrefix,row.codeLast4,row.status,row.createdBy,row.activatedAt,row.suspendedAt,row.version]);
        return { ...row, createdAt: new Date(), updatedAt: new Date() };
      } finally { if (ctx.owns()) c.release(); }
    },
    async findGiftCardByHash(codeHash: string, businessId: string) { const c = await ctx.client(); try { const r = await c.query(`SELECT ${GC} FROM "GiftCard" WHERE "businessId"=$1 AND "codeHash"=$2`, [businessId, codeHash]); return (r.rows[0] as DbGiftCard | undefined) ?? null; } finally { if (ctx.owns()) c.release(); } },
    async findGiftCardById(id: string, businessId: string) { const c = await ctx.client(); try { const r = await c.query(`SELECT ${GC} FROM "GiftCard" WHERE "businessId"=$1 AND "id"=$2`, [businessId, id]); return (r.rows[0] as DbGiftCard | undefined) ?? null; } finally { if (ctx.owns()) c.release(); } },
    async listGiftCards(businessId: string) { const c = await ctx.client(); try { const r = await c.query(`SELECT ${GC} FROM "GiftCard" WHERE "businessId"=$1 ORDER BY "createdAt" DESC, "id" DESC`, [businessId]); return r.rows as DbGiftCard[]; } finally { if (ctx.owns()) c.release(); } },
    async updateGiftCard(id: string, businessId: string, patch: Partial<Omit<DbGiftCard, "id" | "businessId" | "createdAt">>) { const c = await ctx.client(); try { const {sets,values}=buildSet(patch); const r=await c.query(`UPDATE "GiftCard" SET ${sets.length?sets.join(", ")+", ":""}"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$${values.length+1} AND "businessId"=$${values.length+2} RETURNING ${GC}`, [...values,id,businessId]); return (r.rows[0] as DbGiftCard | undefined) ?? null; } finally { if (ctx.owns()) c.release(); } },
    async createGiftCardTransaction(input: Omit<DbGiftCardTransaction, "id" | "createdAt">): Promise<DbGiftCardTransaction> {
      const c = await ctx.client(); try {
        const existing = await c.query(`SELECT ${GCT} FROM "GiftCardTransaction" WHERE "businessId"=$1 AND "idempotencyKey"=$2`, [input.businessId,input.idempotencyKey]); if (existing.rows[0]) return existing.rows[0] as DbGiftCardTransaction;
        const current = await balance("GiftCardTransaction", "amountDeltaMinor", "giftCardId", input.giftCardId, input.businessId); if (current + input.amountDeltaMinor < 0) throw new Error("GIFT_CARD_INSUFFICIENT_BALANCE");
        const row={...input,id:nid("gct")}; await c.query(`INSERT INTO "GiftCardTransaction" ("id","businessId","giftCardId","type","amountDeltaMinor","saleId","refundId","loadId","actorId","requestId","idempotencyKey","reason","branchId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [row.id,row.businessId,row.giftCardId,row.type,row.amountDeltaMinor,row.saleId,row.refundId,row.loadId,row.actorId,row.requestId,row.idempotencyKey,row.reason,row.branchId]);
        return { ...row, createdAt: new Date() };
      } finally { if (ctx.owns()) c.release(); }
    },
    async listGiftCardTransactions(giftCardId: string, businessId: string) { const c=await ctx.client(); try { const r=await c.query(`SELECT ${GCT} FROM "GiftCardTransaction" WHERE "businessId"=$1 AND "giftCardId"=$2 ORDER BY "createdAt" ASC,"id" ASC`,[businessId,giftCardId]); return r.rows as DbGiftCardTransaction[]; } finally { if(ctx.owns()) c.release(); } },
    async findGiftCardTransactionByIdempotency(businessId: string, idempotencyKey: string) { const c=await ctx.client(); try { const r=await c.query(`SELECT ${GCT} FROM "GiftCardTransaction" WHERE "businessId"=$1 AND "idempotencyKey"=$2`,[businessId,idempotencyKey]); return (r.rows[0] as DbGiftCardTransaction|undefined)??null; } finally { if(ctx.owns()) c.release(); } },
    async createStoreCreditAccount(input: Omit<DbStoreCreditAccount, "id" | "createdAt" | "updatedAt">): Promise<DbStoreCreditAccount> { const c=await ctx.client(); try { const found=await c.query(`SELECT ${SCA} FROM "StoreCreditAccount" WHERE "businessId"=$1 AND "customerId"=$2`,[input.businessId,input.customerId]); if(found.rows[0]) return found.rows[0] as DbStoreCreditAccount; const row={...input,id:nid("sca")}; await c.query(`INSERT INTO "StoreCreditAccount" ("id","businessId","customerId") VALUES ($1,$2,$3)`,[row.id,row.businessId,row.customerId]); return {...row,createdAt:new Date(),updatedAt:new Date()}; } finally { if(ctx.owns()) c.release(); } },
    async findStoreCreditAccount(customerId: string, businessId: string) { const c=await ctx.client(); try { const r=await c.query(`SELECT ${SCA} FROM "StoreCreditAccount" WHERE "businessId"=$1 AND "customerId"=$2`,[businessId,customerId]); return (r.rows[0] as DbStoreCreditAccount|undefined)??null; } finally { if(ctx.owns()) c.release(); } },
    async createStoreCreditTransaction(input: Omit<DbStoreCreditTransaction, "id" | "createdAt">): Promise<DbStoreCreditTransaction> { const c=await ctx.client(); try { const found=await c.query(`SELECT ${SCT} FROM "StoreCreditTransaction" WHERE "businessId"=$1 AND "idempotencyKey"=$2`,[input.businessId,input.idempotencyKey]); if(found.rows[0]) return found.rows[0] as DbStoreCreditTransaction; const current=await balance("StoreCreditTransaction","amountDeltaMinor","accountId",input.accountId,input.businessId); if(current+input.amountDeltaMinor<0) throw new Error("STORE_CREDIT_INSUFFICIENT_BALANCE"); const row={...input,id:nid("sct")}; await c.query(`INSERT INTO "StoreCreditTransaction" ("id","businessId","accountId","customerId","type","amountDeltaMinor","saleId","refundId","actorId","requestId","idempotencyKey","reason","branchId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[row.id,row.businessId,row.accountId,row.customerId,row.type,row.amountDeltaMinor,row.saleId,row.refundId,row.actorId,row.requestId,row.idempotencyKey,row.reason,row.branchId]); return {...row,createdAt:new Date()}; } finally { if(ctx.owns()) c.release(); } },
    async listStoreCreditTransactions(accountId: string,businessId: string){const c=await ctx.client();try{const r=await c.query(`SELECT ${SCT} FROM "StoreCreditTransaction" WHERE "businessId"=$1 AND "accountId"=$2 ORDER BY "createdAt" ASC,"id" ASC`,[businessId,accountId]);return r.rows as DbStoreCreditTransaction[];}finally{if(ctx.owns())c.release();}},
    async findStoreCreditTransactionByIdempotency(businessId:string,idempotencyKey:string){const c=await ctx.client();try{const r=await c.query(`SELECT ${SCT} FROM "StoreCreditTransaction" WHERE "businessId"=$1 AND "idempotencyKey"=$2`,[businessId,idempotencyKey]);return(r.rows[0] as DbStoreCreditTransaction|undefined)??null;}finally{if(ctx.owns())c.release();}},
    async upsertLoyaltyProgram(input: Omit<DbLoyaltyProgram,"id"|"updatedAt">): Promise<DbLoyaltyProgram>{const c=await ctx.client();try{const row={...input,id:nid("lp")};const r=await c.query(`INSERT INTO "LoyaltyProgram" ("id","businessId","enabled","earnAmountMinor","earnPoints","redeemPoints","redeemValueMinor","minimumRedeemPoints","version") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT ("businessId") DO UPDATE SET "enabled"=EXCLUDED."enabled","earnAmountMinor"=EXCLUDED."earnAmountMinor","earnPoints"=EXCLUDED."earnPoints","redeemPoints"=EXCLUDED."redeemPoints","redeemValueMinor"=EXCLUDED."redeemValueMinor","minimumRedeemPoints"=EXCLUDED."minimumRedeemPoints","version"="LoyaltyProgram"."version"+1,"updatedAt"=CURRENT_TIMESTAMP RETURNING ${LP}`,[row.id,row.businessId,row.enabled,row.earnAmountMinor,row.earnPoints,row.redeemPoints,row.redeemValueMinor,row.minimumRedeemPoints,row.version]);return r.rows[0] as DbLoyaltyProgram;}finally{if(ctx.owns())c.release();}},
    async getLoyaltyProgram(businessId:string){const c=await ctx.client();try{const r=await c.query(`SELECT ${LP} FROM "LoyaltyProgram" WHERE "businessId"=$1`,[businessId]);return(r.rows[0] as DbLoyaltyProgram|undefined)??null;}finally{if(ctx.owns())c.release();}},
    async createLoyaltyAccount(input: Omit<DbLoyaltyAccount,"id"|"createdAt"|"updatedAt">): Promise<DbLoyaltyAccount>{const c=await ctx.client();try{const found=await c.query(`SELECT ${LA} FROM "LoyaltyAccount" WHERE "businessId"=$1 AND "customerId"=$2`,[input.businessId,input.customerId]);if(found.rows[0])return found.rows[0] as DbLoyaltyAccount;const row={...input,id:nid("la")};await c.query(`INSERT INTO "LoyaltyAccount" ("id","businessId","customerId") VALUES ($1,$2,$3)`,[row.id,row.businessId,row.customerId]);return{...row,createdAt:new Date(),updatedAt:new Date()};}finally{if(ctx.owns())c.release();}},
    async findLoyaltyAccount(customerId:string,businessId:string){const c=await ctx.client();try{const r=await c.query(`SELECT ${LA} FROM "LoyaltyAccount" WHERE "businessId"=$1 AND "customerId"=$2`,[businessId,customerId]);return(r.rows[0] as DbLoyaltyAccount|undefined)??null;}finally{if(ctx.owns())c.release();}},
    async createLoyaltyTransaction(input: Omit<DbLoyaltyTransaction,"id"|"createdAt">): Promise<DbLoyaltyTransaction>{const c=await ctx.client();try{const found=await c.query(`SELECT ${LT} FROM "LoyaltyTransaction" WHERE "businessId"=$1 AND "idempotencyKey"=$2`,[input.businessId,input.idempotencyKey]);if(found.rows[0])return found.rows[0] as DbLoyaltyTransaction;const r0=await c.query(`SELECT COALESCE(SUM("pointsDelta"),0) AS "balance" FROM "LoyaltyTransaction" WHERE "businessId"=$1 AND "accountId"=$2`,[input.businessId,input.accountId]);const current=Number(r0.rows[0]?.balance??0);if(current+input.pointsDelta<0&&!input.type.startsWith("REFUND_EARN"))throw new Error("LOYALTY_INSUFFICIENT_POINTS");const row={...input,id:nid("lt")};await c.query(`INSERT INTO "LoyaltyTransaction" ("id","businessId","accountId","customerId","type","pointsDelta","valueMinorSnapshot","saleId","refundId","actorId","requestId","idempotencyKey","reason") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[row.id,row.businessId,row.accountId,row.customerId,row.type,row.pointsDelta,row.valueMinorSnapshot,row.saleId,row.refundId,row.actorId,row.requestId,row.idempotencyKey,row.reason]);return{...row,createdAt:new Date()};}finally{if(ctx.owns())c.release();}},
    async listLoyaltyTransactions(accountId:string,businessId:string){const c=await ctx.client();try{const r=await c.query(`SELECT ${LT} FROM "LoyaltyTransaction" WHERE "businessId"=$1 AND "accountId"=$2 ORDER BY "createdAt" ASC,"id" ASC`,[businessId,accountId]);return r.rows as DbLoyaltyTransaction[];}finally{if(ctx.owns())c.release();}},
    async findLoyaltyTransactionByIdempotency(businessId:string,idempotencyKey:string){const c=await ctx.client();try{const r=await c.query(`SELECT ${LT} FROM "LoyaltyTransaction" WHERE "businessId"=$1 AND "idempotencyKey"=$2`,[businessId,idempotencyKey]);return(r.rows[0] as DbLoyaltyTransaction|undefined)??null;}finally{if(ctx.owns())c.release();}},
    async createSaleGiftCardLoad(input: Omit<DbSaleGiftCardLoad,"id"|"createdAt">):Promise<DbSaleGiftCardLoad>{const c=await ctx.client();try{const row={...input,id:nid("sgl")};await c.query(`INSERT INTO "SaleGiftCardLoad" ("id","businessId","saleId","giftCardId","amountMinor","kind") VALUES ($1,$2,$3,$4,$5,$6)`,[row.id,row.businessId,row.saleId,row.giftCardId,row.amountMinor,row.kind]);return{...row,createdAt:new Date()};}finally{if(ctx.owns())c.release();}},
    async updateSaleGiftCardLoad(id:string,businessId:string,patch:Partial<Pick<DbSaleGiftCardLoad,"giftCardId">>){const c=await ctx.client();try{const r=await c.query(`UPDATE "SaleGiftCardLoad" SET "giftCardId"=$1 WHERE "id"=$2 AND "businessId"=$3 RETURNING ${SGL}`,[patch.giftCardId??null,id,businessId]);return(r.rows[0] as DbSaleGiftCardLoad|undefined)??null;}finally{if(ctx.owns())c.release();}},
    async listSaleGiftCardLoads(saleId:string,businessId:string){const c=await ctx.client();try{const r=await c.query(`SELECT ${SGL} FROM "SaleGiftCardLoad" WHERE "businessId"=$1 AND "saleId"=$2 ORDER BY "createdAt" ASC,"id" ASC`,[businessId,saleId]);return r.rows as DbSaleGiftCardLoad[];}finally{if(ctx.owns())c.release();}},
    async createSaleLoyalty(input: Omit<DbSaleLoyalty,"id"|"createdAt">):Promise<DbSaleLoyalty>{const c=await ctx.client();try{const row={...input,id:nid("sl")};await c.query(`INSERT INTO "SaleLoyalty" ("id","businessId","saleId","customerId","loyaltyAccountId","programVersion","eligibleSpendMinor","earnedPoints","redeemedPoints","redeemedValueMinor","earnAmountMinorSnapshot","earnPointsSnapshot","redeemPointsSnapshot","redeemValueMinorSnapshot") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[row.id,row.businessId,row.saleId,row.customerId,row.loyaltyAccountId,row.programVersion,row.eligibleSpendMinor,row.earnedPoints,row.redeemedPoints,row.redeemedValueMinor,row.earnAmountMinorSnapshot,row.earnPointsSnapshot,row.redeemPointsSnapshot,row.redeemValueMinorSnapshot]);return{...row,createdAt:new Date()};}finally{if(ctx.owns())c.release();}},
    async findSaleLoyalty(saleId:string,businessId:string){const c=await ctx.client();try{const r=await c.query(`SELECT ${SL} FROM "SaleLoyalty" WHERE "businessId"=$1 AND "saleId"=$2`,[businessId,saleId]);return(r.rows[0] as DbSaleLoyalty|undefined)??null;}finally{if(ctx.owns())c.release();}},
    async updateSaleLoyalty(id:string,businessId:string,patch:Partial<Pick<DbSaleLoyalty,"redeemedPoints"|"redeemedValueMinor"|"earnedPoints">>){const c=await ctx.client();try{const sets:string[]=[];const vals:unknown[]=[];for(const [key,value] of Object.entries(patch)){sets.push(`"${key}"=$${vals.length+1}`);vals.push(value);}if(!sets.length)return this.findSaleLoyalty(id,businessId);const r=await c.query(`UPDATE "SaleLoyalty" SET ${sets.join(", ")} WHERE "id"=$${vals.length+1} AND "businessId"=$${vals.length+2} RETURNING ${SL}`,[...vals,id,businessId]);return(r.rows[0] as DbSaleLoyalty|undefined)??null;}finally{if(ctx.owns())c.release();}},
    async createSaleItemLoyaltyAllocation(input: Omit<DbSaleItemLoyaltyAllocation,"id"|"createdAt">):Promise<DbSaleItemLoyaltyAllocation>{const c=await ctx.client();try{const row={...input,id:nid("sla")};await c.query(`INSERT INTO "SaleItemLoyaltyAllocation" ("id","businessId","saleLoyaltyId","saleItemId","earnedPoints") VALUES ($1,$2,$3,$4,$5)`,[row.id,row.businessId,row.saleLoyaltyId,row.saleItemId,row.earnedPoints]);return{...row,createdAt:new Date()};}finally{if(ctx.owns())c.release();}},
    async listSaleItemLoyaltyAllocations(saleLoyaltyId:string,businessId:string){const c=await ctx.client();try{const r=await c.query(`SELECT ${SLA} FROM "SaleItemLoyaltyAllocation" WHERE "businessId"=$1 AND "saleLoyaltyId"=$2 ORDER BY "createdAt" ASC,"id" ASC`,[businessId,saleLoyaltyId]);return r.rows as DbSaleItemLoyaltyAllocation[];}finally{if(ctx.owns())c.release();}},
  };
}

export type ValueFamily = ReturnType<typeof valueFamily>;
