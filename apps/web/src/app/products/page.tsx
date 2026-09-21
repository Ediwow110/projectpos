"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../lib/api";
import { buildProductSearch } from "../../lib/catalog";

interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  priceMinor: number;
  isActive: boolean;
}

interface SearchResult {
  items: ProductRow[];
  total: number;
  page: number;
  pageSize: number;
}

export default function ProductsPage(): JSX.Element {
  const [q, setQ] = useState("");
  const [active, setActive] = useState("true");
  const [page, setPage] = useState(1);
  const searchQuery = useQuery({
    queryKey: ["products", q, active, page],
    queryFn: () => apiFetch<SearchResult>(buildProductSearch({ q, active, page, pageSize: 20 })),
    retry: false,
  });

  if (searchQuery.isLoading) return <main>Loading products…</main>;
  if (searchQuery.isError)
    return (
      <main>
        <p role="alert">
          {searchQuery.error instanceof ApiError
            ? searchQuery.error.code + ": " + searchQuery.error.message
            : "Could not load products."}
        </p>
      </main>
    );

  const data = searchQuery.data!;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <main>
      <h1>Products</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          void searchQuery.refetch();
        }}
      >
        <label>
          Search name, SKU, or barcode
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Coke, COKE-1, 4800001" />
        </label>
        <label>
          Status
          <select value={active} onChange={(e) => { setActive(e.target.value); setPage(1); }}>
            <option value="true">Active</option>
            <option value="false">Archived</option>
            <option value="all">All</option>
          </select>
        </label>
        <button type="submit">Search</button>
      </form>
      <p>
        {data.total} result{data.total === 1 ? "" : "s"} — page {data.page} of {pages}
      </p>
      <ul>
        {data.items.map((p) => (
          <li key={p.id}>
            <Link href={"/products/" + p.id}>{p.name}</Link>
            {p.sku ? " (" + p.sku + ")" : ""} — {(p.priceMinor / 100).toFixed(2)}
            {p.isActive ? "" : " (archived)"}
          </li>
        ))}
      </ul>
      <div>
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <button disabled={page >= pages} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </div>
      <p>
        <Link href="/categories">Manage categories</Link>
      </p>
    </main>
  );
}
