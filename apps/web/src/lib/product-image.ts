/** Validate optional catalog URLs; callers must guard empty strings before rendering. */
export function validProductImageUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length > 500) return false;
  if (!trimmed.startsWith("https://") && !trimmed.startsWith("http://")) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
