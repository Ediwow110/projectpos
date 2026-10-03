import { createSessionToken, hashToken } from "./sessions";

export const RESET_TTL_MS = 15 * 60_000;

export interface ResetRecord {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
  requestId: string;
  ip: string | null;
}

export function createResetToken(input: {
  userId: string;
  requestId: string;
  ip: string | null;
  now?: Date;
}): { token: string } & ResetRecord {
  const now = input.now ?? new Date();
  const token = createSessionToken();
  return {
    token,
    userId: input.userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + RESET_TTL_MS),
    usedAt: null,
    createdAt: now,
    requestId: input.requestId,
    ip: input.ip,
  };
}

export function consumeResetToken(record: ResetRecord, now: Date = new Date()): void {
  if (record.usedAt !== null) throw new Error("AUTH_TOKEN_USED");
  if (record.expiresAt.getTime() <= now.getTime()) throw new Error("AUTH_TOKEN_EXPIRED");
}
