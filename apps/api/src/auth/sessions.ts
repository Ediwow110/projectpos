import { createHash, randomBytes } from "node:crypto";

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
export const REAUTH_WINDOW_MS = 15 * 60 * 1000;

export interface SessionBuild {
  userId: string;
  businessId: string;
  ip: string | null;
  userAgent: string | null;
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function buildSessionRecord(input: SessionBuild, now: Date = new Date()): {
  token: string;
  tokenHash: string;
  userId: string;
  businessId: string;
  expiresAt: Date;
  createdAt: Date;
  ip: string | null;
  userAgent: string | null;
} {
  const token = createSessionToken();
  return {
    token,
    tokenHash: hashToken(token),
    userId: input.userId,
    businessId: input.businessId,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    createdAt: now,
    ip: input.ip,
    userAgent: input.userAgent,
  };
}

export function isReAuthFresh(authenticatedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - authenticatedAt.getTime() <= REAUTH_WINDOW_MS;
}
