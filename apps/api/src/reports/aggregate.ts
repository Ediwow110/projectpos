export const SETTLED_STATUSES = ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"] as const;

export function isSettled(status: string): boolean {
  return (SETTLED_STATUSES as readonly string[]).includes(status);
}

export interface DateRange {
  from: Date;
  to: Date;
}

const DAY_MS = 24 * 3600 * 1000;
const MAX_RANGE_MS = 366 * DAY_MS;

function parseBound(raw: string | undefined, name: string): Date | null {
  if (raw === undefined) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error("VALIDATION");
  void name;
  return d;
}

export function resolveRange(dateFrom?: string, dateTo?: string, now: Date = new Date()): DateRange {
  const to = parseBound(dateTo, "dateTo") ?? now;
  const from = parseBound(dateFrom, "dateFrom") ?? new Date(to.getTime() - 30 * DAY_MS);
  if (from.getTime() > to.getTime()) throw new Error("VALIDATION");
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) throw new Error("VALIDATION");
  return { from, to };
}

export function previousRange(range: DateRange, compare: string): DateRange | null {
  if (compare === "none") return null;
  if (compare === "previous_year") {
    const from = new Date(range.from);
    from.setUTCFullYear(from.getUTCFullYear() - 1);
    const to = new Date(range.to);
    to.setUTCFullYear(to.getUTCFullYear() - 1);
    return { from, to };
  }
  const span = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - span), to: new Date(range.from.getTime()) };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function bucketKey(d: Date, granularity: "day" | "hour"): string {
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  if (granularity === "hour") return `${day}T${pad(d.getUTCHours())}`;
  return day;
}

export function bucketRange(from: Date, to: Date, granularity: "day" | "hour"): string[] {
  const step = granularity === "hour" ? 3600 * 1000 : DAY_MS;
  const keys: string[] = [];
  // Align the cursor to the bucket start so partial edge days still emit their bucket.
  const cursor = new Date(from);
  if (granularity === "day") cursor.setUTCHours(0, 0, 0, 0);
  else cursor.setUTCMinutes(0, 0, 0);
  while (cursor.getTime() <= to.getTime()) {
    keys.push(bucketKey(cursor, granularity));
    cursor.setTime(cursor.getTime() + step);
  }
  return keys;
}

export function delta(current: number, previous: number): { deltaMinor: number; deltaPct: number | null } {
  return {
    deltaMinor: current - previous,
    deltaPct: previous === 0 ? null : Math.round(((current - previous) / Math.abs(previous)) * 100),
  };
}

export function compareLabel(range: DateRange, compare: string): string {
  if (compare === "none") return "no comparison";
  if (compare === "previous_year") return "vs same dates last year";
  const days = Math.round((range.to.getTime() - range.from.getTime()) / DAY_MS);
  return `vs previous ${days} days`;
}
