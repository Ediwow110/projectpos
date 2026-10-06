import type { DbBusiness, DbBusinessCreate, DbMembership, DbResetToken, DbSession, DbUser } from "../db.port";
import { nid } from "./context";
import type { PgContext } from "./context";

// The tenants family: users, businesses, memberships, sessions, password-reset
// and email-verification tokens. Mapping notes:
// - Runtime `membership.role` is a string; the DDL normalizes roles into the
//   Role table, so createMembership upserts Role(businessId, name) and links
//   the membership to its id; every read joins Role back to the string.
// - Session reads always return the full DbSession shape. activeBusinessId
//   and activeBranchId are null when unset.
export function tenantsFamily(ctx: PgContext) {
  const MEMBERSHIP_SELECT =
    'SELECT m."id", m."businessId", m."userId", r."name" AS "role", m."deactivatedAt", m."approvalPinHash"' +
    ' FROM "BusinessMembership" m JOIN "Role" r ON r."id" = m."roleId"';
  const SESSION_SELECT =
    'SELECT "id", "userId", "businessId", "activeBusinessId", "activeBranchId", "tokenHash", "expiresAt", "revokedAt",' +
    ' "authenticatedAt", "ip", "userAgent", "deviceId" FROM "Session"';

  return {
    async findUserByEmail(email: string): Promise<DbUser | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          'SELECT "id", "name", "email", "passwordHash", "emailVerified", "workspaceTourSeen" FROM "User" WHERE "email" = $1',
          [email],
        );
        return (r.rows[0] as DbUser | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findUserById(id: string): Promise<DbUser | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          'SELECT "id", "name", "email", "passwordHash", "emailVerified", "workspaceTourSeen" FROM "User" WHERE "id" = $1',
          [id],
        );
        return (r.rows[0] as DbUser | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createUser(u: Omit<DbUser, "id">): Promise<DbUser> {
      const c = await ctx.client();
      try {
        const row = { workspaceTourSeen: false, ...u, id: nid("user") };
        // undefined/true both mean verified (Phase 11); the column is NOT NULL.
        await c.query(
          'INSERT INTO "User" ("id", "name", "email", "passwordHash", "emailVerified", "workspaceTourSeen", "createdAt", "updatedAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
          [row.id, row.name, row.email, row.passwordHash, row.emailVerified ?? true, row.workspaceTourSeen ?? false],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async updateUserPassword(id: string, passwordHash: string): Promise<void> {
      const c = await ctx.client();
      try {
        await c.query(
          'UPDATE "User" SET "passwordHash" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $2',
          [passwordHash, id],
        );
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async setUserEmailVerified(id: string, verified: boolean): Promise<void> {
      const c = await ctx.client();
      try {
        await c.query(
          'UPDATE "User" SET "emailVerified" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $2',
          [verified, id],
        );
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async setUserWorkspaceTourSeen(id: string, seen: boolean): Promise<void> {
      const c = await ctx.client();
      try {
        await c.query(
          'UPDATE "User" SET "workspaceTourSeen" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $2',
          [seen, id],
        );
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createBusiness(b: DbBusinessCreate): Promise<DbBusiness> {
      const c = await ctx.client();
      try {
        const row: DbBusiness = { ...b, storefrontKey: b.storefrontKey ?? null, id: nid("biz") };
        await c.query(
          'INSERT INTO "Business" ("id", "name", "currency", "storefrontKey", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
          [row.id, row.name, row.currency, row.storefrontKey],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findBusinessById(id: string): Promise<DbBusiness | null> {
      const c = await ctx.client();
      try {
        const r = await c.query('SELECT "id", "name", "currency", "storefrontKey" FROM "Business" WHERE "id" = $1', [id]);
        return (r.rows[0] as DbBusiness | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findBusinessByStorefrontKey(key: string): Promise<DbBusiness | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          'SELECT "id", "name", "currency", "storefrontKey" FROM "Business" WHERE "storefrontKey" = $1',
          [key],
        );
        return (r.rows[0] as DbBusiness | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async setBusinessStorefrontKey(id: string, key: string): Promise<DbBusiness | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          'UPDATE "Business" SET "storefrontKey" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $2 RETURNING "id", "name", "currency", "storefrontKey"',
          [key, id],
        );
        return (r.rows[0] as DbBusiness | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listMembershipsByUser(userId: string): Promise<DbMembership[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `${MEMBERSHIP_SELECT} WHERE m."userId" = $1 ORDER BY m."createdAt" ASC, m."id" ASC`,
          [userId],
        );
        return r.rows as DbMembership[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listMembershipsByBusiness(businessId: string): Promise<DbMembership[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `${MEMBERSHIP_SELECT} WHERE m."businessId" = $1 ORDER BY m."createdAt" ASC, m."id" ASC`,
          [businessId],
        );
        return r.rows as DbMembership[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findMembership(userId: string, businessId: string): Promise<DbMembership | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `${MEMBERSHIP_SELECT} WHERE m."userId" = $1 AND m."businessId" = $2 ORDER BY m."createdAt" ASC, m."id" ASC`,
          [userId, businessId],
        );
        return (r.rows[0] as DbMembership | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createMembership(m: Omit<DbMembership, "id">): Promise<DbMembership> {
      const c = await ctx.client();
      try {
        const row = { ...m, id: nid("mem") };
        // Upsert the normalized role row for (businessId, name) and link it;
        // the @@unique on ("businessId","name") makes the conflict target safe.
        const role = await c.query(
          'INSERT INTO "Role" ("id", "businessId", "name") VALUES ($1, $2, $3)' +
            ' ON CONFLICT ("businessId", "name") DO UPDATE SET "name" = EXCLUDED."name" RETURNING "id"',
          [nid("role"), m.businessId, m.role],
        );
        await c.query(
          'INSERT INTO "BusinessMembership" ("id", "businessId", "userId", "roleId", "deactivatedAt", "approvalPinHash", "createdAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)',
          [row.id, m.businessId, m.userId, role.rows[0].id as string, m.deactivatedAt ?? null, m.approvalPinHash ?? null],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async updateMembership(
      id: string,
      businessId: string,
      patch: { deactivatedAt?: Date | null; approvalPinHash?: string | null },
    ): Promise<void> {
      const c = await ctx.client();
      try {
        const updates: string[] = [];
        const values: unknown[] = [];
        if (Object.prototype.hasOwnProperty.call(patch, "deactivatedAt")) {
          values.push(patch.deactivatedAt ?? null);
          updates.push(`"deactivatedAt" = $${values.length}`);
        }
        if (Object.prototype.hasOwnProperty.call(patch, "approvalPinHash")) {
          values.push(patch.approvalPinHash ?? null);
          updates.push(`"approvalPinHash" = $${values.length}`);
        }
        if (updates.length === 0) return;
        values.push(id, businessId);
        await c.query(
          `UPDATE "BusinessMembership" SET ${updates.join(", ")} WHERE "id" = $${values.length - 1} AND "businessId" = $${values.length}`,
          values,
        );
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createSession(s: Omit<DbSession, "id">): Promise<DbSession> {
      const c = await ctx.client();
      try {
        const row = { ...s, id: nid("sess") };
        await c.query(
          'INSERT INTO "Session" ("id", "userId", "businessId", "activeBusinessId", "activeBranchId", "tokenHash", "expiresAt", "revokedAt", "authenticatedAt", "ip", "userAgent", "deviceId")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
          [
            row.id, s.userId, s.businessId, s.activeBusinessId ?? null, s.activeBranchId ?? null,
            s.tokenHash, s.expiresAt, s.revokedAt, s.authenticatedAt, s.ip, s.userAgent, s.deviceId ?? null,
          ],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findSessionByTokenHash(tokenHash: string): Promise<DbSession | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(`${SESSION_SELECT} WHERE "tokenHash" = $1`, [tokenHash]);
        return (r.rows[0] as DbSession | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listSessionsByUser(userId: string): Promise<DbSession[]> {
      const c = await ctx.client();
      try {
        // Live sessions only, insertion order — exactly the memory filter.
        const r = await c.query(
          `${SESSION_SELECT} WHERE "userId" = $1 AND "revokedAt" IS NULL ORDER BY "createdAt" ASC, "id" ASC`,
          [userId],
        );
        return r.rows as DbSession[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async updateSession(
      id: string,
      patch: { activeBusinessId?: string | null; activeBranchId?: string | null; authenticatedAt?: Date },
    ): Promise<void> {
      const c = await ctx.client();
      try {
        const sets: string[] = [];
        const values: unknown[] = [];
        if (patch.activeBusinessId !== undefined) {
          values.push(patch.activeBusinessId);
          sets.push(`"activeBusinessId" = $${values.length}`);
        }
        if (patch.activeBranchId !== undefined) {
          values.push(patch.activeBranchId);
          sets.push(`"activeBranchId" = $${values.length}`);
        }
        if (patch.authenticatedAt !== undefined) {
          values.push(patch.authenticatedAt);
          sets.push(`"authenticatedAt" = $${values.length}`);
        }
        if (sets.length === 0) return;
        values.push(id);
        await c.query(
          `UPDATE "Session" SET ${sets.join(", ")} WHERE "id" = $${values.length}`,
          values,
        );
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async revokeSession(id: string): Promise<void> {
      const c = await ctx.client();
      try {
        await c.query('UPDATE "Session" SET "revokedAt" = $1 WHERE "id" = $2', [new Date(), id]);
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async revokeAllUserSessions(userId: string, exceptId?: string): Promise<void> {
      const c = await ctx.client();
      try {
        await c.query(
          'UPDATE "Session" SET "revokedAt" = $1 WHERE "userId" = $2 AND ($3::text IS NULL OR "id" <> $3)',
          [new Date(), userId, exceptId ?? null],
        );
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async saveResetToken(t: DbResetToken): Promise<void> {
      const c = await ctx.client();
      try {
        await c.query(
          'INSERT INTO "PasswordResetToken" ("id", "userId", "tokenHash", "expiresAt", "usedAt", "requestId", "ip", "createdAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)',
          [nid("res"), t.userId, t.tokenHash, t.expiresAt, t.usedAt, t.requestId, t.ip],
        );
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findResetToken(tokenHash: string): Promise<DbResetToken | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          'SELECT "userId", "tokenHash", "expiresAt", "usedAt", "requestId", "ip" FROM "PasswordResetToken" WHERE "tokenHash" = $1',
          [tokenHash],
        );
        return (r.rows[0] as DbResetToken | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async markResetTokenUsed(tokenHash: string, usedAt: Date): Promise<void> {
      const c = await ctx.client();
      try {
        await c.query('UPDATE "PasswordResetToken" SET "usedAt" = $1 WHERE "tokenHash" = $2', [usedAt, tokenHash]);
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createEmailVerificationToken(t: { userId: string; tokenHash: string; expiresAt: Date }): Promise<{ id: string }> {
      const c = await ctx.client();
      try {
        const id = nid("evt");
        await c.query(
          'INSERT INTO "EmailVerificationToken" ("id", "userId", "tokenHash", "expiresAt", "usedAt", "createdAt")' +
            ' VALUES ($1, $2, $3, $4, NULL, CURRENT_TIMESTAMP)',
          [id, t.userId, t.tokenHash, t.expiresAt],
        );
        return { id };
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findEmailVerificationToken(tokenHash: string): Promise<{ id: string; userId: string; expiresAt: Date; usedAt: Date | null } | null> {
      const c = await ctx.client();
      try {
        // Returned regardless of used/expired state; the service decides.
        const r = await c.query(
          'SELECT "id", "userId", "expiresAt", "usedAt" FROM "EmailVerificationToken" WHERE "tokenHash" = $1',
          [tokenHash],
        );
        return (r.rows[0] as { id: string; userId: string; expiresAt: Date; usedAt: Date | null } | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async markEmailVerificationTokenUsed(id: string): Promise<void> {
      const c = await ctx.client();
      try {
        await c.query('UPDATE "EmailVerificationToken" SET "usedAt" = $1 WHERE "id" = $2', [new Date(), id]);
      } finally {
        if (ctx.owns()) c.release();
      }
    },
  };
}

export type TenantsFamily = ReturnType<typeof tenantsFamily>;
