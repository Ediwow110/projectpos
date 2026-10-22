import { apiBase } from "./api";

export interface SalesExportFilters {
  status: string;
  customerId: string;
  dateFrom: string;
  dateTo: string;
}

/** The CSV must describe the rows the reviewer is looking at, not the whole journal. */
export function salesExportUrl(filters: SalesExportFilters): string {
  const params = new URLSearchParams({ format: "csv" });
  for (const [key, value] of Object.entries(filters)) {
    if (value.trim() !== "") params.set(key, value.trim());
  }
  return `${apiBase()}/api/v1/sales/export?${params.toString()}`;
}
