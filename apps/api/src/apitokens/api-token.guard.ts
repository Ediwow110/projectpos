import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import "reflect-metadata";
import type { DbPort } from "../common/db.port";
import { createRateLimiter } from "../common/rate-limit";
import { BillingService } from "../billing/nest/billing.service";
import { SCOPES_KEY, scopesSatisfied } from "./scopes.decorator";

export const TOKEN_RATE_LIMIT = 60;
export const TOKEN_RATE_WINDOW_MS = 60_000;

interface TokenAuth {
  userId: string;
  businessId: string;
  role: "api";
  tokenId: string;
  scopes: string[];
  via: "api-token";
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

@Injectable()
export class ApiTokenGuard implements CanActivate {
  // Phase 12: the token bucket moved onto the shared pluggable limiter so the
  // 60/min/token cap holds across app instances when the pg backend is
  // installed (identical record-then-count semantics to the old Map).
  private readonly tokenLimiter = createRateLimiter(TOKEN_RATE_LIMIT, TOKEN_RATE_WINDOW_MS);

  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  private deny(req: { authError?: string }): false {
    req.authError = "TENANT_REQUIRED";
    return false;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const raw: string | undefined = req.headers?.["authorization"];
    if (!raw || !raw.startsWith("Bearer ")) return true;
    const secret = raw.slice("Bearer ".length).trim();
    const prefix = secret.split("_").slice(0, 2).join("_");
    const candidates = await this.db.listApiTokensByPrefix(prefix);
    // A short prefix can collide, so every candidate is checked against the
    // presented secret's hash in constant time.
    const row = candidates.find((t) => this.timingSafeCompare(t.tokenHash, sha256Hex(secret))) ?? null;
    if (!row) return this.deny(req);
    if (row.revokedAt !== null) return this.deny(req);
    if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()) return this.deny(req);
    const required: string[] | undefined =
      Reflect.getMetadata(SCOPES_KEY, context.getHandler()) ??
      Reflect.getMetadata(SCOPES_KEY, context.getClass());
    if (required === undefined) {
      req.authError = "FORBIDDEN";
      return false;
    }
    const granted = row.scopes as string[];
    if (!scopesSatisfied(required, granted)) {
      req.authError = "FORBIDDEN";
      return false;
    }
    try {
      await new BillingService(this.db).requireFeature(row.businessId, "api");
    } catch (e) {
      // Keep the machine fields so the caller sees which entitlement is
      // missing, exactly like a session-authenticated 402. The error envelope
      // carries string arrays, so shape them here.
      const err = e as { message?: string; fields?: Record<string, string> };
      req.authError = err.message === "PLAN_LIMIT" ? "PLAN_LIMIT" : "FORBIDDEN";
      if (err.message === "PLAN_LIMIT" && err.fields) {
        req.authErrorFields = Object.fromEntries(
          Object.entries(err.fields).map(([k, v]) => [k, [v]]),
        );
      }
      return false;
    }
    if (await this.tokenLimiter.hit(`token:${row.id}`)) {
      req.authError = "RATE_LIMITED";
      return false;
    }
    const auth: TokenAuth = {
      userId: `apitoken:${row.id}`,
      businessId: row.businessId,
      role: "api",
      tokenId: row.id,
      scopes: granted,
      via: "api-token",
    };
    req.auth = auth;
    return true;
  }

  timingSafeCompare(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }
}
