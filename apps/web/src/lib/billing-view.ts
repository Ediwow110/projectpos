import { trialDaysLeft, usagePct } from "./billing";
import { formatMoneyMinor } from "./money";

/**
 * View model for the read-only /billing screen.
 *
 * The whole point of this module is that absence is never rendered as a
 * quantity. `GET /api/v1/billing/subscription` answers with a `UsageSlice`
 * per cap, and both "no cap" and "no data" are represented by an absent/zero
 * number in the payload, so the mapping has to be explicit:
 *
 *   limit: null        -> `unmetered`   ("Unmetered", never a limit number)
 *   limit: 0           -> `not-included`("Not included"; in use -> "Over limit")
 *   limit: 1..n        -> `metered`     ("used of limit", plus full/breached)
 *   slice absent/failed-> `unknown`     ("Data unavailable", never "0 of 3")
 *
 * `usagePct()` saturates at 100, so a breached cap and a merely full one share
 * a percentage; `breached`/`full` are derived from the raw counts instead,
 * which is what keeps them distinguishable on screen.
 */

export type FetchState = "loading" | "error" | "ready";
export type CapKey = "users" | "products" | "registers" | "branches";
export type MeterKind = "unknown" | "metered" | "unmetered" | "not-included";
// `info` covers the rows that carry no risk signal at all (an unmetered cap, a
// resource the plan does not include but has not exceeded).
export type MeterTone = "ok" | "warn" | "bad" | "info";
export type PillTone = "ok" | "warn" | "bad" | "info";

/** Exactly the `{ used, limit }` pair `UsageSlice` in the API carries. */
export interface UsageSliceWire {
  used: number;
  limit: number | null;
}

/** `GET /api/v1/billing/subscription` after JSON encoding (Dates arrive as ISO strings). */
export interface SubscriptionWire {
  planKey: string;
  status: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  usage: {
    users?: UsageSliceWire | null;
    products?: UsageSliceWire | null;
    registers?: UsageSliceWire | null;
    branches?: UsageSliceWire | null;
    salesMonthly?: number | null;
  };
}

/** Exactly the `DbInvoice` rows `GET /api/v1/billing/invoices` returns as `{ items: [...] }`. */
export interface InvoiceWire {
  id: string;
  businessId: string;
  subscriptionId: string;
  periodStart: string;
  periodEnd: string;
  amountMinor: number;
  currency: string;
  status: string;
  issuedAt: string;
  paidAt: string | null;
}

export interface UsageMeter {
  key: CapKey;
  label: string;
  kind: MeterKind;
  used: number | null;
  limit: number | null;
  pct: number | null;
  full: boolean;
  breached: boolean;
  valueText: string;
  pctText: string;
  stateText: string;
  tone: MeterTone;
}

export interface TrialCountdown {
  daysLeft: number | null;
  ended: boolean;
  text: string;
  tone: PillTone;
}

export interface BillingOverview {
  state: FetchState;
  planKey: string | null;
  planName: string;
  statusLabel: string | null;
  statusTone: PillTone | null;
  trial: TrialCountdown | null;
  periodEndText: string;
  meters: UsageMeter[];
  salesMonthly: number | null;
  salesMonthlyText: string;
}

export interface InvoiceRow {
  id: string;
  idLabel: string;
  periodText: string;
  issuedText: string;
  amountText: string;
  currency: string;
  statusLabel: string;
  paidText: string;
  tone: PillTone;
}

export interface InvoiceLedger {
  state: FetchState;
  rows: InvoiceRow[];
  statusText: string;
}

const UNAVAILABLE = "Unavailable";

// The cap keys the subscription payload exposes. `lib/billing.ts` keeps its
// singular `RESOURCE_LABELS` map private, so this mirrors its exact wording for
// the four keys this screen can render ("User", "Product", "Register", "Branch")
// rather than inventing a second vocabulary for the same caps.
const CAP_KEYS: Array<{ key: CapKey; label: string }> = [
  { key: "users", label: "User" },
  { key: "products", label: "Product" },
  { key: "registers", label: "Register" },
  { key: "branches", label: "Branch" },
];

const STATUS_LABELS: Record<string, { label: string; tone: PillTone }> = {
  active: { label: "Active", tone: "ok" },
  trialing: { label: "Trialing", tone: "info" },
  past_due: { label: "Past due", tone: "warn" },
  canceled: { label: "Canceled", tone: "bad" },
  cancelled: { label: "Canceled", tone: "bad" },
};

const INVOICE_STATUS: Record<string, { label: string; tone: PillTone }> = {
  open: { label: "Open", tone: "warn" },
  paid: { label: "Paid", tone: "ok" },
  void: { label: "Void", tone: "info" },
};

const DATE_PARTS: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
};

function planName(planKey: string): string {
  return planKey.charAt(0).toUpperCase() + planKey.slice(1);
}

function titleCase(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function epochMs(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDate(value: unknown): string {
  const ms = epochMs(value);
  return ms === null ? UNAVAILABLE : new Date(ms).toLocaleDateString("en-PH", DATE_PARTS);
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function meterKind(limit: number | null): MeterKind {
  if (limit === null) return "unmetered";
  if (limit <= 0) return "not-included";
  return "metered";
}

function unknownMeter(key: CapKey, label: string): UsageMeter {
  return {
    key,
    label,
    kind: "unknown",
    used: null,
    limit: null,
    pct: null,
    full: false,
    breached: false,
    valueText: UNAVAILABLE,
    pctText: UNAVAILABLE,
    stateText: "Data unavailable",
    tone: "warn",
  };
}

/**
 * Reads one `UsageSlice` off the wire. `null` means the server did not give us
 * this pair (absent slice, absent/non-finite count, malformed limit), which the
 * caller must render as unavailable rather than as zero usage.
 */
function readSlice(
  value: UsageSliceWire | null | undefined,
): { used: number; limit: number | null } | null {
  if (typeof value !== "object" || value === null) return null;
  const used = finite(value.used);
  if (used === null) return null;
  if (value.limit === null) return { used, limit: null };
  if (typeof value.limit === "number" && Number.isFinite(value.limit)) return { used, limit: value.limit };
  return null;
}

function buildMeter(key: CapKey, label: string, slice: UsageSliceWire | null | undefined): UsageMeter {
  const read = readSlice(slice);
  if (!read) return unknownMeter(key, label);

  const { used, limit } = read;
  const kind = meterKind(limit);
  const pct = usagePct(used, limit);
  const breached = limit !== null && used > limit;
  const full = kind === "metered" && used === limit;

  let stateText = "In use";
  let tone: MeterTone = "ok";
  if (kind === "unmetered") {
    stateText = "Unmetered";
    tone = "info";
  } else if (kind === "not-included") {
    stateText = "Not included";
    tone = "info";
  }
  if (breached) {
    stateText = "Over limit";
    tone = "bad";
  } else if (full) {
    stateText = "At limit";
    tone = "warn";
  }

  // Only a metered cap prints a `used of limit` pair; an unmetered cap must not
  // render its absent limit as a number, so it prints the count alone.
  const valueText = kind === "metered" ? `${used} of ${limit}` : `${used} in use`;

  return {
    key,
    label,
    kind,
    used,
    limit,
    pct,
    full,
    breached,
    valueText,
    pctText: pct === null ? "Unmetered" : `${pct}%`,
    stateText,
    tone,
  };
}

function buildTrial(trialEndsAt: unknown, nowMs: number): TrialCountdown | null {
  if (typeof trialEndsAt !== "string" || trialEndsAt.trim() === "") return null;
  if (epochMs(trialEndsAt) === null) {
    // A date the server sent but nobody can read: factual text, never "NaN days".
    return { daysLeft: null, ended: false, text: "Trial end date unavailable", tone: "warn" };
  }
  const days = trialDaysLeft(trialEndsAt, nowMs);
  if (days === null || !Number.isFinite(days)) {
    return { daysLeft: null, ended: false, text: "Trial end date unavailable", tone: "warn" };
  }
  if (days <= 0) return { daysLeft: 0, ended: true, text: "Trial has ended", tone: "warn" };
  return {
    daysLeft: days,
    ended: false,
    text: `${days} day${days === 1 ? "" : "s"} left in trial`,
    tone: "info",
  };
}

export function billingOverview(
  state: FetchState,
  data: SubscriptionWire | null | undefined,
  nowMs: number = Date.now(),
): BillingOverview {
  const meters = CAP_KEYS.map(({ key, label }) =>
    data && state === "ready" ? buildMeter(key, label, data.usage?.[key]) : unknownMeter(key, label),
  );

  const usable = state === "ready" && data ? data : null;
  const status = usable ? STATUS_LABELS[usable.status] : undefined;

  let periodEndText = UNAVAILABLE;
  if (usable) {
    periodEndText =
      usable.currentPeriodEnd === null
        ? "No current period on file"
        : formatDate(usable.currentPeriodEnd);
  }

  const salesMonthly = usable ? finite(usable.usage?.salesMonthly) : null;

  return {
    state,
    planKey: usable ? usable.planKey : null,
    planName: usable ? planName(usable.planKey) : UNAVAILABLE,
    statusLabel: usable ? (status?.label ?? titleCase(usable.status)) : null,
    statusTone: usable ? (status?.tone ?? "info") : null,
    trial: usable ? buildTrial(usable.trialEndsAt, nowMs) : null,
    periodEndText,
    meters,
    salesMonthly,
    salesMonthlyText: salesMonthly === null ? UNAVAILABLE : String(salesMonthly),
  };
}

function invoiceAmount(minor: number | null, currency: string): string {
  if (minor === null) return UNAVAILABLE;
  const value = formatMoneyMinor(minor);
  if (currency === "PHP") return `₱${value}`;
  return currency ? `${currency} ${value}` : value;
}

function buildInvoice(row: InvoiceWire): InvoiceRow | null {
  if (typeof row.id !== "string" || row.id.trim() === "") return null;
  const status = INVOICE_STATUS[row.status];
  const paidMs = epochMs(row.paidAt);

  return {
    id: row.id,
    idLabel: `Invoice ${row.id.slice(0, 8)}`,
    periodText:
      epochMs(row.periodStart) === null || epochMs(row.periodEnd) === null
        ? UNAVAILABLE
        : `${formatDate(row.periodStart)} – ${formatDate(row.periodEnd)}`,
    issuedText: formatDate(row.issuedAt),
    amountText: invoiceAmount(finite(row.amountMinor), typeof row.currency === "string" ? row.currency : ""),
    currency: typeof row.currency === "string" ? row.currency : "",
    statusLabel: status?.label ?? (row.status ? titleCase(row.status) : UNAVAILABLE),
    paidText: row.paidAt === null ? "Not paid" : paidMs === null ? UNAVAILABLE : formatDate(row.paidAt),
    tone: status?.tone ?? "info",
  };
}

export function invoiceLedger(
  state: FetchState,
  items: InvoiceWire[] | null | undefined,
): InvoiceLedger {
  if (state !== "ready") {
    return {
      state,
      rows: [],
      statusText: state === "loading" ? "Loading invoices…" : "Invoices could not be loaded.",
    };
  }

  const rows = (Array.isArray(items) ? items : [])
    .map((item) => buildInvoice(item))
    .filter((row): row is InvoiceRow => row !== null);

  return {
    state,
    rows,
    statusText:
      rows.length === 0
        ? "No invoices have been issued for this business."
        : `${rows.length} ${rows.length === 1 ? "invoice" : "invoices"} on file.`,
  };
}
