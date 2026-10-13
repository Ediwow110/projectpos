import type { DbGuestSupportCase, DbPlatformConsent } from "../db.port";
import { nid, type PgContext } from "./context";

const CASE = '"id","businessId","orderId","category","description","status","idempotencyKey","createdAt","closedAt","closedBy"';
const CONSENT = '"id","businessId","ownerId","purpose","tokenHash","createdAt","expiresAt","revokedAt"';

export function phaseDFamily(ctx: PgContext) {
  return {
    async createGuestSupportCase(input: Omit<DbGuestSupportCase, "id" | "createdAt">): Promise<DbGuestSupportCase> {
      const c = await ctx.client();
      try {
        const r = await c.query(`INSERT INTO "GuestSupportCase" ("id","businessId","orderId","category","description","status","idempotencyKey","closedAt","closedBy")
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${CASE}`,
        [nid("gsc"), input.businessId, input.orderId, input.category, input.description, input.status, input.idempotencyKey, input.closedAt, input.closedBy]);
        return r.rows[0] as DbGuestSupportCase;
      } finally { if (ctx.owns()) c.release(); }
    },
    async findGuestSupportCaseByKey(businessId: string, key: string): Promise<DbGuestSupportCase | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(`SELECT ${CASE} FROM "GuestSupportCase" WHERE "businessId"=$1 AND "idempotencyKey"=$2`, [businessId, key]);
        return (r.rows[0] as DbGuestSupportCase | undefined) ?? null;
      } finally { if (ctx.owns()) c.release(); }
    },
    async listGuestSupportCases(businessId: string): Promise<DbGuestSupportCase[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(`SELECT ${CASE} FROM "GuestSupportCase" WHERE "businessId"=$1 ORDER BY "createdAt" DESC,"id" DESC`, [businessId]);
        return r.rows as DbGuestSupportCase[];
      } finally { if (ctx.owns()) c.release(); }
    },
    async closeGuestSupportCase(id: string, businessId: string, actorId: string): Promise<DbGuestSupportCase | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(`UPDATE "GuestSupportCase" SET "status"='CLOSED',"closedAt"=CURRENT_TIMESTAMP,"closedBy"=$3 WHERE "id"=$1 AND "businessId"=$2 AND "status"='OPEN' RETURNING ${CASE}`, [id,businessId,actorId]);
        return (r.rows[0] as DbGuestSupportCase | undefined) ?? null;
      } finally { if (ctx.owns()) c.release(); }
    },
    async createPlatformConsent(input: Omit<DbPlatformConsent, "id" | "createdAt">): Promise<DbPlatformConsent> {
      const c = await ctx.client();
      try {
        const r = await c.query(`INSERT INTO "PlatformOwnerConsent" ("id","businessId","ownerId","purpose","tokenHash","expiresAt","revokedAt")
          VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${CONSENT}`,
          [nid("consent"),input.businessId,input.ownerId,input.purpose,input.tokenHash,input.expiresAt,input.revokedAt]);
        return r.rows[0] as DbPlatformConsent;
      } finally { if (ctx.owns()) c.release(); }
    },
    async findPlatformConsentByHash(businessId: string, tokenHash: string): Promise<DbPlatformConsent | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(`SELECT ${CONSENT} FROM "PlatformOwnerConsent" WHERE "businessId"=$1 AND "tokenHash"=$2`, [businessId,tokenHash]);
        return (r.rows[0] as DbPlatformConsent | undefined) ?? null;
      } finally { if (ctx.owns()) c.release(); }
    },
    async listPlatformConsents(businessId: string): Promise<DbPlatformConsent[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(`SELECT ${CONSENT} FROM "PlatformOwnerConsent" WHERE "businessId"=$1 ORDER BY "createdAt" DESC`, [businessId]);
        return r.rows as DbPlatformConsent[];
      } finally { if (ctx.owns()) c.release(); }
    },
    async revokePlatformConsent(id: string, businessId: string): Promise<DbPlatformConsent | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(`UPDATE "PlatformOwnerConsent" SET "revokedAt"=COALESCE("revokedAt",CURRENT_TIMESTAMP) WHERE "id"=$1 AND "businessId"=$2 RETURNING ${CONSENT}`, [id,businessId]);
        return (r.rows[0] as DbPlatformConsent | undefined) ?? null;
      } finally { if (ctx.owns()) c.release(); }
    },
  };
}
