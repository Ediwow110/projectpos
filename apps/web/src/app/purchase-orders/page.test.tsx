import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  search: "",
  requested: [] as string[],
  keys: [] as string[],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/purchase-orders",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(fixture.search),
}));

vi.mock("../../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  apiFetch: (path: string) => {
    fixture.requested.push(path);
    return Promise.resolve(path.startsWith("/api/v1/purchase-orders")
      ? { items: [], total: 0, page: 1, pageSize: 20 }
      : path === "/api/v1/me"
        ? { role: "owner", businessName: "QA Business", activeBranchId: null }
        : { items: [] });
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: unknown[]; queryFn?: () => Promise<unknown>; enabled?: boolean }) => {
    const key = options.queryKey.map((part) => String(part)).join("|");
    fixture.keys.push(key);
    if (options.enabled !== false) void options.queryFn?.();
    return { data: undefined, isLoading: false, isPending: false, isError: false, error: null, refetch: vi.fn() };
  },
  useQueryClient: () => ({ clear: vi.fn(), setQueryData: vi.fn(), invalidateQueries: vi.fn(), refetchQueries: vi.fn() }),
}));

import PurchaseOrdersPage from "./page";

function renderWithSupplier(search: string): string {
  fixture.search = search;
  fixture.requested = [];
  fixture.keys = [];
  vi.stubGlobal("React", React);
  return renderToStaticMarkup(<PurchaseOrdersPage />);
}

describe("purchase-order register supplier filter", () => {
  beforeEach(() => {
    fixture.search = "";
    fixture.requested = [];
    fixture.keys = [];
  });

  it("passes the supplierId query param through to the purchase-order path builder", () => {
    renderWithSupplier("supplierId=sup-9");

    const listPath = fixture.requested.find((path) => path.startsWith("/api/v1/purchase-orders"));
    expect(listPath, `expected a purchase-order list request, saw ${fixture.requested.join(", ")}`)
      .toContain("supplierId=sup-9");
    expect(fixture.keys.find((key) => key.startsWith("purchase-orders|"))).toContain("sup-9");
  });

  it("omits the parameter when the register is opened without a supplier", () => {
    renderWithSupplier("");

    const listPath = fixture.requested.find((path) => path.startsWith("/api/v1/purchase-orders"));
    expect(listPath).toBeDefined();
    expect(listPath).not.toContain("supplierId");
  });

  it("tells the user the register is scoped to one supplier and offers to clear it", () => {
    const filtered = renderWithSupplier("supplierId=sup-9");
    expect(filtered).toContain("Filtered to one supplier.");
    expect(filtered).toContain('data-ui="clear-supplier-filter"');
    expect(filtered).toContain('href="/purchase-orders"');

    const unfiltered = renderWithSupplier("");
    expect(unfiltered).not.toContain("Filtered to one supplier.");
    expect(unfiltered).not.toContain('data-ui="clear-supplier-filter"');
  });

  it("agrees with the supplier history link on the query-parameter name", () => {
    const supplierDetail = readFileSync(new URL("../suppliers/[id]/page.tsx", import.meta.url), "utf8");
    expect(supplierDetail).toContain("/purchase-orders?supplierId=${supplier.id}");
  });
});
