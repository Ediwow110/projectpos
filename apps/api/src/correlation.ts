export function getCorrelationId(headers: Record<string, string | undefined>, fallback = ""): string {
  const fromHeader = headers["x-request-id"];
  if (fromHeader && fromHeader.trim() !== "") return fromHeader;
  if (fallback.trim() !== "") return fallback;
  return `req_${Date.now()}`;
}
