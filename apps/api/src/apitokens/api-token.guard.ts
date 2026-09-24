import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import "reflect-metadata";
import type { DbPort } from "../common/db.port";
import { SCOPES_KEY, scopesSatisfied } from "./scopes.decorator";

export const TOKEN_RATE_LIMIT = 60;
export const TOKEN_RATE_WINDOW_MS = 60_000;

export function bucketAllowed(hits: number[], nowMs: number, limit = TOKEN_RATE_LIMIT, windowMs = TOKEN_RATE_WINDOW_MS): boolean {
  return hits.filter((t) => t > nowMs - windowMs).length < limit;
}

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
  private readonly buckets = new Map<string, number[]>();

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
    const row = await this.db.findApiTokenByPrefix(prefix);
    if (!row || !this.timingSafeCompare(row.tokenHash, sha256Hex(secret))) return this.deny(req);
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
    const now = Date.now();
    const hits = (this.buckets.get(row.id) ?? []).filter((t) => t > now - TOKEN_RATE_WINDOW_MS);
    if (!bucketAllowed(hits, now)) {
      req.authError = "RATE_LIMITED";
      return false;
    }
    hits.push(now);
    this.buckets.set(row.id, hits);
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
