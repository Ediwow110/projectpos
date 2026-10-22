import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

interface Seed {
  id: string;
  category: string;
  amountMinor: number;
  method: string;
  expenseDate: string;
  voidedAt: string | null;
  description: string | null;
}

const ROWS: Seed[] = [
  {
    id: "e1",
    category: "Rent",
    amountMinor: 125000,
    method: "cash",
    expenseDate: "2026-10-22T00:00:00.000Z",
    voidedAt: null,
    description: "Studio rent",
  },
  {
    id: "e2",
    category: "Utilities",
    amountMinor: 4500,
    method: "gcash",
    expenseDate: "2026-10-21T00:00:00.000Z",
    voidedAt: null,
    description: null,
  },
];

function query(key: string): Record<string, unknown> {
  if (key === "me") {
    return {
      data: { role: "owner", businessName: "Ledger Store", permissions: ["export.run", "expense.void"] },
      isPending: false,
      isLoading: false,
      isError: false,
      error: null,
    };
  }
  if (key === "expenses") {
    return { data: { items: ROWS, total: ROWS.length }, isPending: false, isLoading: false, isError: false, error: null };
  }
  return { data: undefined, isPending: false, isLoading: false, isError: false, error: null };
}

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => query(String(queryKey[0])),
}));

import ExpensesPage from "./page";

Object.assign(globalThis, { React });

describe("expense ledger rows", () => {
  it("shows the description the operator recorded", () => {
    const html = renderToStaticMarkup(<ExpensesPage />);
    // The record form collects an optional description and the service stores
    // it; a ledger that never shows it leaves the operator unable to tell two
    // same-category expenses apart.
    expect(html).toContain("Studio rent");
  });

  it("renders a row without a description as the category alone", () => {
    const html = renderToStaticMarkup(<ExpensesPage />);
    expect(html).toContain("Utilities");
    expect(html).not.toContain(">null<");
  });
});
