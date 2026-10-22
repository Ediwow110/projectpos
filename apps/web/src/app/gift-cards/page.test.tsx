import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api";

const fixture = vi.hoisted(() => ({
  role: "cashier",
  permissions: ["gift_card.manage"] as string[] | undefined,
  cards: [] as unknown[],
  cardsError: null as { status: number; code: string; message: string } | null,
  cardsLoading: false,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));
vi.mock("../../components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "me") {
      return { data: { role: fixture.role, businessName: "QA Business", permissions: fixture.permissions }, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    }
    return {
      data: fixture.cardsError ? undefined : fixture.cards,
      isLoading: fixture.cardsLoading,
      isError: fixture.cardsError !== null,
      error: fixture.cardsError
        ? new ApiError(fixture.cardsError.code, fixture.cardsError.message, "req_test", fixture.cardsError.status)
        : null,
      refetch: vi.fn(),
    };
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn().mockResolvedValue(undefined) }),
}));

import GiftCardsPage from "./page";

describe("gift cards access", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    fixture.role = "cashier";
    fixture.permissions = ["gift_card.manage"];
    fixture.cards = [];
    fixture.cardsError = null;
    fixture.cardsLoading = false;
  });

  it("states that the session may not read gift cards instead of showing an empty register", () => {
    fixture.cardsError = { status: 403, code: "FORBIDDEN", message: "Forbidden" };

    const html = renderToStaticMarkup(<GiftCardsPage />);

    // A refused read must never look like an empty register: zeros would read
    // as truth to the operator.
    expect(html).toContain("You do not have access to gift cards");
    expect(html).not.toContain("No gift cards have been issued.");
    expect(html).not.toContain("Outstanding liability");
  });

  it("states that the register could not be loaded when the read failed for another reason", () => {
    fixture.cardsError = { status: 500, code: "SERVER", message: "Boom" };

    const html = renderToStaticMarkup(<GiftCardsPage />);

    expect(html).toContain("Could not load gift cards");
    expect(html).not.toContain("No gift cards have been issued.");
    expect(html).not.toContain("Outstanding liability");
  });

  it("does not offer card issuance to a session the server withheld gift_card.manage from", () => {
    fixture.permissions = ["sale.create"];

    const html = renderToStaticMarkup(<GiftCardsPage />);

    expect(html).not.toContain("+ Issue gift card");
  });

  it("offers card issuance to a session that holds gift_card.manage", () => {
    const html = renderToStaticMarkup(<GiftCardsPage />);

    expect(html).toContain("+ Issue gift card");
  });
});
