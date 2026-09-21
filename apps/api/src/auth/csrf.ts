import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function issueCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function verifyCsrfToken(expected: string, presented: string | undefined): void {
  if (!presented) throw new Error("CSRF_REQUIRED");
  const a = Buffer.from(createHash("sha256").update(expected).digest("hex"));
  const b = Buffer.from(createHash("sha256").update(presented).digest("hex"));
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("CSRF_MISMATCH");
}
