export function normalizeOrderEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) {
    throw new Error("VALIDATION");
  }
  return normalized;
}

export function normalizeOrderPhone(value: string): string {
  const trimmed = value.trim();
  const leadingPlus = trimmed.startsWith("+");
  const body = trimmed.replace(/[\s().-]/g, "").replace(/^\+/, "");
  const normalized = (leadingPlus ? "+" : "") + body;
  if (!/^\+?\d{7,15}$/.test(normalized)) throw new Error("VALIDATION");
  return normalized;
}
