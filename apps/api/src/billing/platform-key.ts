import { timingSafeEqual } from "node:crypto";

export function platformKeyConfigured(): boolean {
  return (process.env["PLATFORM_API_KEY"] ?? "").length > 0;
}

export function isPlatformKey(provided: string | undefined): boolean {
  const expected = process.env["PLATFORM_API_KEY"] ?? "";
  if (!provided || expected.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
