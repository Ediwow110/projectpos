import { randomUUID } from "node:crypto";
import type { DbPort } from "../common/db.port";
import type { PgContext } from "../common/pg/context";
import { incrementMetric } from "../common/metrics";
import { OrderAccessService } from "./order-access-service";
import type { OrderNotificationService } from "./order-notification-service";

/**
 * Queue rows deliberately contain neither customer PII nor bearer tokens.
 * A fresh hashed-in-storage STATUS token is minted only at delivery time.
 * Provider acceptance is not an exactly-once guarantee: a crash between
 * sending and acknowledging can result in a second email after lease expiry.
 */
export type OrderOutboxStatus = "PENDING" | "PROCESSING" | "SENT" | "DEAD" | "CANCELLED";
export interface OrderOutboxJob {
  id: string;
  businessId: string;
  orderId: string;
  event: string;
  dedupeKey: string;
  status: OrderOutboxStatus;
  attempts: number;
  nextAttemptAt: Date;
  leaseId: string | null;
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export type NewOrderOutboxJob = Pick<OrderOutboxJob, "businessId" | "orderId" | "event" | "dedupeKey">;

function validateQueueInput(input: NewOrderOutboxJob): void {
  // These are trusted internal identifiers/status codes, never arbitrary
  // customer text, provider responses, URLs or bearer tokens.
  if (!input.businessId || !input.orderId ||
      !/^[A-Z][A-Z0-9_]{0,63}$/.test(input.event) ||
      !/^[a-zA-Z0-9:_-]{1,128}$/.test(input.dedupeKey)) {
    throw new Error("INVALID_OUTBOX_INPUT");
  }
}

export interface OrderNotificationOutboxStore {
  enqueue(job: NewOrderOutboxJob, now?: Date): Promise<OrderOutboxJob>;
  claimDue(now: Date, limit: number, leaseMs: number): Promise<OrderOutboxJob[]>;
  markSent(id: string, leaseId: string, now: Date): Promise<boolean>;
  markFailed(id: string, leaseId: string, now: Date, maxAttempts: number, permanent?: boolean): Promise<"RETRY" | "DEAD" | "STALE">;
  cancelOrder(businessId: string, orderId: string, now: Date): Promise<number>;
}

export function retryDelayMs(attempts: number): number {
  return Math.min(3_600_000, 30_000 * 2 ** Math.min(Math.max(0, attempts - 1), 7));
}

export function createMemoryOrderNotificationOutbox(): OrderNotificationOutboxStore & { listForTests(): Promise<OrderOutboxJob[]> } {
  const rows = new Map<string, OrderOutboxJob>();
  return {
    async enqueue(input, now = new Date()) {
      validateQueueInput(input);
      const existing = [...rows.values()].find((row) => row.businessId === input.businessId && row.dedupeKey === input.dedupeKey);
      if (existing) {
        if (existing.orderId !== input.orderId || existing.event !== input.event) throw new Error("CONFLICT");
        return { ...existing };
      }
      const job: OrderOutboxJob = {
        ...input, id: randomUUID(), status: "PENDING", attempts: 0, leaseId: null,
        lockedUntil: null, nextAttemptAt: now, createdAt: now, updatedAt: now,
      };
      rows.set(job.id, job);
      return { ...job };
    },
    async claimDue(now, limit, leaseMs) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(leaseMs) || leaseMs < 1000) {
        throw new Error("INVALID_OUTBOX_LEASE");
      }
      const due = [...rows.values()].filter((job) =>
        (job.status === "PENDING" || (job.status === "PROCESSING" && !!job.lockedUntil && job.lockedUntil <= now))
        && job.nextAttemptAt <= now,
      ).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)).slice(0, limit);
      return due.map((job) => {
        const next: OrderOutboxJob = {
          ...job, status: "PROCESSING", attempts: job.attempts + 1,
          leaseId: randomUUID(), lockedUntil: new Date(now.getTime() + leaseMs), updatedAt: now,
        };
        rows.set(next.id, next);
        return { ...next };
      });
    },
    async markSent(id, leaseId, now) {
      const job = rows.get(id);
      if (!job || job.leaseId !== leaseId || job.status !== "PROCESSING" || !job.lockedUntil || job.lockedUntil <= now) return false;
      rows.set(id, { ...job, status: "SENT", leaseId: null, lockedUntil: null, updatedAt: now });
      return true;
    },
    async markFailed(id, leaseId, now, maxAttempts, permanent = false) {
      const job = rows.get(id);
      if (!job || job.leaseId !== leaseId || job.status !== "PROCESSING" || !job.lockedUntil || job.lockedUntil <= now) return "STALE";
      const dead = permanent || job.attempts >= maxAttempts;
      rows.set(id, {
        ...job, status: dead ? "DEAD" : "PENDING", leaseId: null, lockedUntil: null,
        nextAttemptAt: new Date(now.getTime() + retryDelayMs(job.attempts)), updatedAt: now,
      });
      return dead ? "DEAD" : "RETRY";
    },
    async cancelOrder(businessId, orderId, now) {
      let n = 0;
      for (const job of rows.values()) {
        if (job.businessId === businessId && job.orderId === orderId && ["PENDING", "PROCESSING"].includes(job.status)) {
          rows.set(job.id, { ...job, status: "CANCELLED", leaseId: null, lockedUntil: null, updatedAt: now });
          n++;
        }
      }
      return n;
    },
    async listForTests() { return [...rows.values()].map((job) => ({ ...job })); },
  };
}

const JOB_COLUMNS = '"id","businessId","orderId","event","dedupeKey","status","attempts","nextAttemptAt","leaseId","lockedUntil","createdAt","updatedAt"';

/**
 * PostgreSQL is the cross-instance authority: claimDue leases rows with
 * FOR UPDATE SKIP LOCKED and acknowledgments are compare-and-swap on leaseId.
 * The migration must be applied *only* after separate release approval.
 */
export class PgOrderNotificationOutbox implements OrderNotificationOutboxStore {
  constructor(private readonly ctx: PgContext) {}

  async assertReady(): Promise<void> {
    const c = await this.ctx.client();
    try {
      const result = await c.query<{ tablePresent: string | null }>(
        'SELECT to_regclass($1) AS "tablePresent"', ['public."OrderNotificationOutbox"'],
      );
      if (!result.rows[0]?.tablePresent) throw new Error("OUTBOX_MIGRATION_REQUIRED");
    } finally { if (this.ctx.owns()) c.release(); }
  }

  async enqueue(input: NewOrderOutboxJob, now = new Date()): Promise<OrderOutboxJob> {
    validateQueueInput(input);
    const c = await this.ctx.client();
    try {
      const result = await c.query<OrderOutboxJob>(
        'INSERT INTO "OrderNotificationOutbox" ("id","businessId","orderId","event","dedupeKey","nextAttemptAt","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$6,$6) ' +
        'ON CONFLICT ("businessId","dedupeKey") DO UPDATE SET "dedupeKey"=EXCLUDED."dedupeKey" RETURNING ' + JOB_COLUMNS,
        [randomUUID(), input.businessId, input.orderId, input.event, input.dedupeKey, now],
      );
      const job = result.rows[0]!;
      if (job.orderId !== input.orderId || job.event !== input.event) throw new Error("CONFLICT");
      return job;
    } finally { if (this.ctx.owns()) c.release(); }
  }

  async claimDue(now: Date, limit: number, leaseMs: number): Promise<OrderOutboxJob[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(leaseMs) || leaseMs < 1000) {
      throw new Error("INVALID_OUTBOX_LEASE");
    }
    const c = await this.ctx.client();
    try {
      const result = await c.query<OrderOutboxJob>(
        'WITH due AS (SELECT "id" FROM "OrderNotificationOutbox" ' +
        'WHERE ("status" = $1 OR ("status" = $2 AND "lockedUntil" <= $3)) ' +
        'AND "nextAttemptAt" <= $3 ORDER BY "createdAt","id" FOR UPDATE SKIP LOCKED LIMIT $4) ' +
        'UPDATE "OrderNotificationOutbox" q SET "status"=$2,"attempts"=q."attempts"+1,"leaseId"=$5,"lockedUntil"=$6,"updatedAt"=$3 ' +
        'FROM due WHERE q."id"=due."id" RETURNING ' + JOB_COLUMNS.split(",").map((col) => "q." + col).join(","),
        ["PENDING", "PROCESSING", now, limit, randomUUID(), new Date(now.getTime() + leaseMs)],
      );
      return result.rows;
    } finally { if (this.ctx.owns()) c.release(); }
  }

  async markSent(id: string, leaseId: string, now: Date): Promise<boolean> {
    const c = await this.ctx.client();
    try {
      const result = await c.query(
        'UPDATE "OrderNotificationOutbox" SET "status"=$4,"leaseId"=NULL,"lockedUntil"=NULL,"updatedAt"=$3 ' +
        'WHERE "id"=$1 AND "leaseId"=$2 AND "status"=$5 AND "lockedUntil" > $3',
        [id, leaseId, now, "SENT", "PROCESSING"],
      );
      return (result.rowCount ?? 0) === 1;
    } finally { if (this.ctx.owns()) c.release(); }
  }

  async markFailed(id: string, leaseId: string, now: Date, maxAttempts: number, permanent = false): Promise<"RETRY" | "DEAD" | "STALE"> {
    const c = await this.ctx.client();
    try {
      const result = await c.query<{ status: "PENDING" | "DEAD" }>(
        'UPDATE "OrderNotificationOutbox" SET "status"=CASE WHEN $4 OR "attempts" >= $5 THEN $6 ELSE $7 END,' +
        '"nextAttemptAt"=$3 + make_interval(secs => LEAST(3600, 30 * power(2, LEAST(GREATEST("attempts" - 1, 0), 7)))::int),' +
        '"leaseId"=NULL,"lockedUntil"=NULL,"updatedAt"=$3 ' +
        'WHERE "id"=$1 AND "leaseId"=$2 AND "status"=$8 AND "lockedUntil" > $3 RETURNING "status"',
        [id, leaseId, now, permanent, maxAttempts, "DEAD", "PENDING", "PROCESSING"],
      );
      if (!result.rows[0]) return "STALE";
      return result.rows[0].status === "DEAD" ? "DEAD" : "RETRY";
    } finally { if (this.ctx.owns()) c.release(); }
  }

  async cancelOrder(businessId: string, orderId: string, now: Date): Promise<number> {
    const c = await this.ctx.client();
    try {
      const result = await c.query(
        'UPDATE "OrderNotificationOutbox" SET "status"=$4,"leaseId"=NULL,"lockedUntil"=NULL,"updatedAt"=$3 ' +
        'WHERE "businessId"=$1 AND "orderId"=$2 AND "status" IN ($5,$6)',
        [businessId, orderId, now, "CANCELLED", "PENDING", "PROCESSING"],
      );
      return result.rowCount ?? 0;
    } finally { if (this.ctx.owns()) c.release(); }
  }
}

export class OrderNotificationOutboxWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly db: DbPort,
    private readonly store: OrderNotificationOutboxStore,
    private readonly notifications: OrderNotificationService,
    private readonly maxAttempts = 6,
  ) {}

  // A new process may begin polling the same PostgreSQL table immediately.
  // Leases prevent simultaneous claims across instances and on restart.
  start(intervalMs = 10_000): void {
    if (this.timer) return;
    if (!Number.isInteger(intervalMs) || intervalMs < 1000) throw new Error("INVALID_OUTBOX_INTERVAL");
    this.timer = setInterval(() => { void this.poll(); }, intervalMs);
    this.timer.unref?.();
    void this.poll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch {
      // An outage must not stop future ticks or leak provider details.
      incrementMetric("pos_order_notification_outbox_poll_failures_total");
    } finally {
      this.running = false;
    }
  }

  async runOnce(now = new Date()): Promise<{ claimed: number; sent: number; retried: number; dead: number }> {
    const jobs = await this.store.claimDue(now, 10, 120_000);
    const result = { claimed: jobs.length, sent: 0, retried: 0, dead: 0 };
    for (const job of jobs) {
      const status = await this.deliver(job, now);
      if (status === "SENT") result.sent++;
      if (status === "RETRY") result.retried++;
      if (status === "DEAD") result.dead++;
    }
    return result;
  }

  private async deliver(job: OrderOutboxJob, now: Date): Promise<"SENT" | "RETRY" | "DEAD" | "STALE"> {
    let permanent = false;
    try {
      const order = await this.db.findOrderById(job.orderId, job.businessId);
      if (!order?.email) {
        permanent = true;
      } else {
        const access = new OrderAccessService(this.db);
        const minted = await access.mintStatusToken(job.businessId, job.orderId);
        const accepted = await this.notifications.sendExistingToken(job.businessId, job.orderId, job.event, minted.token);
        if (accepted) {
          return await this.store.markSent(job.id, job.leaseId!, now) ? "SENT" : "STALE";
        }
        // Never leave an undelivered replacement token active. Existing
        // customer links remain valid through all retry attempts.
        await this.db.revokeOrderAccessToken(minted.row.id, job.businessId, new Date());
      }
    } catch {
      // Provider/database errors are intentionally not persisted in the job.
    }
    const outcome = await this.store.markFailed(job.id, job.leaseId!, now, this.maxAttempts, permanent);
    return outcome === "RETRY" ? "RETRY" : outcome;
  }
}
