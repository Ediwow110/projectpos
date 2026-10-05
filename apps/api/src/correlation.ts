const MAX_CORRELATION_ID_LENGTH = 128;
const SAFE_CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function isSafeCorrelationId(value: string): boolean {
  return value.length <= MAX_CORRELATION_ID_LENGTH && SAFE_CORRELATION_ID.test(value);
}

export function getCorrelationId(headers: Record<string, string | undefined>, fallback = ""): string {
  const fromHeader = headers["x-request-id"]?.trim();
  if (fromHeader && isSafeCorrelationId(fromHeader)) return fromHeader;
  const safeFallback = fallback.trim();
  if (safeFallback && isSafeCorrelationId(safeFallback)) return safeFallback;
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
