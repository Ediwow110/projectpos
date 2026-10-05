export interface LogFields {
  correlationId: string;
  businessId?: string;
  userId?: string;
  action?: string;
  route?: string;
  status?: number;
  durationMs?: number;
  outcome?: string;
}

const SECRET_KEYS = /password|secret|token|cookie|authorization|credential|api[-_]?key|bearer/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<!\d)(?:\+?\d[\d ()-]{7,}\d)(?!\d)/g;

function redactString(value: string): string {
  return value
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/((?:password|secret|token|cookie|authorization|credential|api[-_]?key)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(EMAIL, "[REDACTED_EMAIL]")
    .replace(PHONE, "[REDACTED_PHONE]");
}

function redact(value: unknown, key?: string): unknown {
  if (key && SECRET_KEYS.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((entry) => redact(entry));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([entryKey, entry]) => [entryKey, redact(entry, entryKey)]));
  return value;
}

export function createLogger() {
  return {
    info(fields: LogFields, message: string): string {
      return JSON.stringify(redact({ level: "info", message, ...fields, timestamp: new Date().toISOString() }));
    },
  };
}
