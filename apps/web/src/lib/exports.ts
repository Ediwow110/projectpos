import { apiBase } from "./api";

/**
 * Both bounds are enforced by the API and restated here so the reviewer knows
 * what they are downloading. The contract tests read the server's own numbers,
 * so this cannot quietly drift from what is actually streamed.
 */
export const LEDGER_ROW_WINDOW = 5000;
export const EXPENSES_ROW_WINDOW = 1000;

export function canExport(permissions: readonly string[]): boolean {
  return permissions.includes("export.run");
}

export function ledgerDownloadUrl(range: { dateFrom: string; dateTo: string }): string {
  const params = new URLSearchParams({ format: "csv" });
  const dateFrom = range.dateFrom.trim();
  const dateTo = range.dateTo.trim();
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  return `${apiBase()}/api/v1/exports/ledger.csv?${params.toString()}`;
}

export function expensesDownloadUrl(filters: { category: string }): string {
  const params = new URLSearchParams({ format: "csv" });
  const category = filters.category.trim();
  if (category) params.set("category", category);
  return `${apiBase()}/api/v1/expenses/export?${params.toString()}`;
}
