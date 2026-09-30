"use client";

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "./api";
import { buildProductSearch } from "./catalog";
import type { PosHeldSale, PosProduct } from "./pos-sale-model";

export interface PosMe {
  userId: string;
  businessId: string;
  role: string;
  businessName?: string;
  activeBranchId: string | null;
  activeBranchName: string | null;
}

export interface PosPaymentMethodConfig {
  key: string;
  label: string;
  available: boolean;
  provider: string;
}

export function usePosData(query: string, activeCategoryId: string, customerQuery: string) {
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<PosMe>("/api/v1/me"),
    retry: false,
  });
  const customersQuery = useQuery({
    queryKey: ["pos-customers", customerQuery],
    queryFn: () => apiFetch<{ items: Array<{ id: string; name: string; phone: string | null }> }>(
      "/api/v1/customers?" + new URLSearchParams({ q: customerQuery, active: "true", page: "1", pageSize: "10" }).toString(),
    ),
    retry: false,
  });
  const registersQuery = useQuery({
    queryKey: ["pos-registers"],
    queryFn: () => apiFetch<{ items: Array<{ id: string; name: string; isActive: boolean; branchId: string | null; branchName: string | null }> }>("/api/v1/registers"),
    retry: false,
  });
  const paymentMethodsQuery = useQuery({
    queryKey: ["payment-methods"],
    queryFn: () => apiFetch<{ methods: PosPaymentMethodConfig[] }>("/api/v1/payments/methods"),
    retry: false,
  });
  const categoriesQuery = useQuery({
    queryKey: ["pos-categories"],
    queryFn: () => apiFetch<{ items: Array<{ id: string; name: string; isActive: boolean }> }>("/api/v1/categories"),
    retry: false,
  });
  const searchQuery = useQuery({
    queryKey: ["pos-products", query, activeCategoryId],
    queryFn: () =>
      apiFetch<{ items: PosProduct[]; total: number; page: number; pageSize: number }>(
        buildProductSearch({
          q: query,
          categoryId: activeCategoryId || undefined,
          active: "true",
          page: 1,
          pageSize: 24,
        }),
      ),
    retry: false,
  });
  const heldSalesQuery = useQuery({
    queryKey: ["pos-held-sales"],
    queryFn: () => apiFetch<{ items: PosHeldSale[] }>("/api/v1/sales/held"),
    retry: false,
    enabled: meQuery.data !== undefined && ["owner", "manager", "cashier"].includes(meQuery.data.role),
  });

  return {
    meQuery,
    customersQuery,
    registersQuery,
    paymentMethodsQuery,
    categoriesQuery,
    searchQuery,
    heldSalesQuery,
  };
}
