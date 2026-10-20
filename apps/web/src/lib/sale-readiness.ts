/**
 * Shared first-sale readiness contract.
 *
 * The server is the single authority for readiness
 * (`apps/api/src/business/nest/business.service.ts` → `getSaleReadiness`).
 * The web app presents those values and never re-derives them, so the UI can
 * never claim a business is sale-ready when the server disagrees.
 */

export interface SaleReadiness {
  businessConfigured: boolean;
  /** Optional so a payload from an older server cannot crash a render. */
  legacySetupReviewSteps?: string[];
  hasSellableProduct: boolean;
  hasActiveRegister: boolean;
  hasOpenShift: boolean;
  hasStaff: boolean;
  canCustomizeReceipt: boolean;
  readyForFirstSale: boolean;
  /** Server-named outstanding gaps. Optional so older servers stay usable. */
  missing?: string[];
}

export interface SaleReadinessCheck {
  key: string;
  label: string;
  href: string;
  done: boolean;
  pending: string;
}

/**
 * A branch is deliberately absent: `registerCreateSchema.branchId` is optional
 * and branch creation is capped at zero on free/basic/pro plans
 * (`apps/api/src/common/pg/pg-plans-seed.ts`). A register never depends on a
 * branch, so a branch must never be presented as a first-sale prerequisite.
 */
export const FIRST_SALE_CHECKS: readonly {
  key: string;
  label: string;
  href: string;
  pending: string;
  done: (readiness: SaleReadiness) => boolean;
}[] = [
  {
    key: "sellable_product_or_stock",
    label: "Sellable product with available stock",
    href: "/products",
    pending: "No sellable product yet",
    done: (readiness) => readiness.hasSellableProduct,
  },
  {
    key: "active_register",
    label: "Active register",
    href: "/registers",
    pending: "No active register yet",
    done: (readiness) => readiness.hasActiveRegister,
  },
  {
    key: "open_shift",
    label: "Open shift",
    href: "/shifts",
    pending: "No open shift yet",
    done: (readiness) => readiness.hasOpenShift,
  },
];

const GAP_LABELS: Record<string, string> = {
  business_setup: "Required business setup has not been saved.",
  business_setup_review: "Business setup needs to be reviewed and saved.",
  stock_at_open_register: "No stock is available at the open register.",
};

/** An unrecognised server key must never reach the owner as a raw token. */
const UNKNOWN_GAP_LABEL = "One more server-reported setup requirement is outstanding.";

export function saleReadinessChecks(readiness: SaleReadiness): SaleReadinessCheck[] {
  return FIRST_SALE_CHECKS.map((check) => ({
    key: check.key,
    label: check.label,
    href: check.href,
    pending: check.pending,
    done: check.done(readiness),
  }));
}

/**
 * Outstanding server gaps that the visible checklist does not already show.
 * A readiness payload is a runtime value, so non-string or non-array keys are
 * ignored rather than rendered, and one rendered label appears at most once:
 * several unknown machine keys must not stack duplicate warning lines.
 */
export function readinessGapLabels(readiness: SaleReadiness): string[] {
  const covered = new Set(FIRST_SALE_CHECKS.map((check) => check.key));
  const keys = Array.isArray(readiness.missing) ? readiness.missing : [];
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (typeof key !== "string") continue;
    const trimmed = key.trim();
    if (!trimmed || covered.has(trimmed)) continue;
    const label = GAP_LABELS[trimmed] ?? UNKNOWN_GAP_LABEL;
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

export interface SavedBusinessSettings {
  name: string;
  address: string;
  phone: string;
  timezone: string;
  currency: string;
  taxName: string;
  taxRateBps: number | null;
  receiptConfirmed: boolean;
  receiptHeader: string;
  receiptFooter: string;
}

/**
 * Reads persisted business settings from the server payload only. Unsaved form
 * state is deliberately ignored so a review summary can never show a value the
 * business has not actually stored.
 */
export function readSavedBusinessSettings(business: {
  name: string;
  currency: string;
  settings: Record<string, unknown>;
}): SavedBusinessSettings {
  const settings = business.settings ?? {};
  const text = (key: string): string =>
    typeof settings[key] === "string" ? (settings[key] as string) : "";
  return {
    name: business.name,
    address: text("businessAddress"),
    phone: text("businessPhone"),
    timezone: text("businessTimezone"),
    currency: business.currency,
    taxName: text("taxName"),
    taxRateBps: typeof settings["taxRateBps"] === "number" ? settings["taxRateBps"] : null,
    receiptConfirmed: settings["standardReceiptConfirmed"] === true,
    receiptHeader: text("receiptHeader"),
    receiptFooter: text("receiptFooter"),
  };
}

export function formatTaxRate(taxRateBps: number | null): string {
  if (taxRateBps === null) return "No tax rate saved";
  return `${(taxRateBps / 100).toLocaleString("en-PH", { maximumFractionDigits: 2 })}%`;
}
