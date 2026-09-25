import type { DbDevice } from "../db.port";
import { nid } from "./context";
import type { PgContext } from "./context";

// The devices family: POS device registrations and their session lifecycle.
// Mapping notes:
// - Runtime columns are exactly migration 0010's DDL; the port shape carries no
//   timestamps, so "createdAt" is written but never read back.
// - listDevicesByBusiness replicates memory's Map insertion order via
//   ORDER BY "createdAt" ASC, "id" ASC.
// - revokeSessionsByDevice mirrors memory: only live sessions (revokedAt IS
//   NULL) bound to the device within the business get stamped; an
//   already-revoked session keeps its original stamp, and sessions of other
//   devices or businesses are untouched.
const DEVICE_COLUMNS = '"id", "businessId", "userId", "label", "revokedAt"';

export function devicesFamily(ctx: PgContext) {
  return {
    async createDevice(d: Omit<DbDevice, "id">): Promise<DbDevice> {
      const c = await ctx.client();
      try {
        const row = { ...d, id: nid("dev") };
        await c.query(
          'INSERT INTO "Device" ("id", "businessId", "userId", "label", "revokedAt", "createdAt")' +
            ' VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)',
          [row.id, row.businessId, row.userId, row.label, row.revokedAt],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listDevicesByBusiness(businessId: string): Promise<DbDevice[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${DEVICE_COLUMNS} FROM "Device" WHERE "businessId" = $1 ORDER BY "createdAt" ASC, "id" ASC`,
          [businessId],
        );
        return r.rows as DbDevice[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findDeviceById(id: string, businessId: string): Promise<DbDevice | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${DEVICE_COLUMNS} FROM "Device" WHERE "id" = $1 AND "businessId" = $2`,
          [id, businessId],
        );
        return (r.rows[0] as DbDevice | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async revokeDevice(id: string, businessId: string, revokedAt: Date): Promise<DbDevice | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `UPDATE "Device" SET "revokedAt" = $1 WHERE "id" = $2 AND "businessId" = $3 RETURNING ${DEVICE_COLUMNS}`,
          [revokedAt, id, businessId],
        );
        return (r.rows[0] as DbDevice | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async revokeSessionsByDevice(businessId: string, deviceId: string): Promise<void> {
      const c = await ctx.client();
      try {
        await c.query(
          'UPDATE "Session" SET "revokedAt" = $1 WHERE "businessId" = $2 AND "deviceId" = $3 AND "revokedAt" IS NULL',
          [new Date(), businessId, deviceId],
        );
      } finally {
        if (ctx.owns()) c.release();
      }
    },
  };
}

export type DevicesFamily = ReturnType<typeof devicesFamily>;
