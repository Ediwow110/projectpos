const SENSITIVE_KEYS = new Set(["password", "passwordHash", "token", "tokenHash", "approvalToken", "csrfToken", "authorization"]);

export function toSafeLogContext(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = SENSITIVE_KEYS.has(k) ? "[redacted]" : v;
  }
  return out;
}
