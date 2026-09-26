"use client";

import type { JSX } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function createAppQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        // Operational reads (inventory, sales, shifts, reports) remain stale
        // immediately so revisiting a page still fetches authoritative data.
        staleTime: 0,
        gcTime: 10 * 60_000,
        refetchOnReconnect: true,
      },
    },
  });
  // Identity/role metadata is shared by nearly every route and changes far
  // less often than stock/sales data, so keep only this query warm briefly.
  client.setQueryDefaults(["me"], { staleTime: 60_000 });
  return client;
}

export function Providers({ children }: { children: ReactNode }): JSX.Element {
  const [client] = useState(createAppQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
