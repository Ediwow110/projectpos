"use client";

import type { JSX } from "react";

import Link from "next/link";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../../lib/api";
import { canEditCatalog, canSeeCost } from "../../../lib/catalog";

interface ProductDetail {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  brand: string | null;
  unit: string;
  costMinor?: number;
  priceMinor: number;
  taxRateBps: number | null;
  reorderLevel: number;
  trackInventory: boolean;
  isActive: boolean;
  categoryId: string | null;
}

interface Me {
  role: string;
}

interface Csrf {
  csrfToken: string;
}

function money(minor: number): string {
  return (minor / 100).toFixed(2);
}

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }): JSX.Element {
  const { id } = use(params);
  const [error, setError] = useState("");
  const [price, setPrice] = useState("");
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const detailQuery = useQuery({
    queryKey: ["product", id],
    queryFn: () => apiFetch<ProductDetail>("/api/v1/products/" + id),
    retry: false,
  });

  async function mutate(path: string, init: RequestInit): Promise<void> {
    setError("");
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch(path, { csrfToken: csrf.csrfToken, init });
      await detailQuery.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.code + ": " + err.message : "Update failed");
    }
  }

  if (detailQuery.isLoading) return <main>Loading product…</main>;
  if (detailQuery.isError || !detailQuery.data)
    return (
      <main>
        <p role="alert">Product not found.</p>
        <Link href="/products">Back to products</Link>
      </main>
    );

  const p = detailQuery.data;
  const role = meQuery.data?.role ?? "cashier";
  const editable = canEditCatalog(role);
  const showCost = canSeeCost(role);

  return (
    <main>
      <Link href="/products">Back to products</Link>
      <h1>{p.name}</h1>
      <dl>
        <dt>SKU</dt>
        <dd>{p.sku ?? "—"}</dd>
        <dt>Barcode</dt>
        <dd>{p.barcode ?? "—"}</dd>
        <dt>Price</dt>
        <dd>{money(p.priceMinor)}</dd>
        {showCost && (
          <>
            <dt>Cost</dt>
            <dd>{money(p.costMinor ?? 0)}</dd>
          </>
        )}
        <dt>Status</dt>
        <dd>{p.isActive ? "Active" : "Archived"}</dd>
      </dl>
      {editable && (
        <section>
          <h2>Edit price</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const minor = Math.round(Number(price) * 100);
              if (!Number.isInteger(minor) || minor < 0) {
                setError("VALIDATION: price must be a non-negative amount");
                return;
              }
              void mutate("/api/v1/products/" + id, {
                method: "PATCH",
                body: JSON.stringify({ priceMinor: minor }),
              });
            }}
          >
            <label>
              New price
              <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="25.00" />
            </label>
            <button type="submit">Save price</button>
          </form>
          {p.isActive ? (
            <button onClick={() => void mutate("/api/v1/products/" + id + "/archive", { method: "POST" })}>
              Archive product
            </button>
          ) : (
            <button onClick={() => void mutate("/api/v1/products/" + id + "/restore", { method: "POST" })}>
              Restore product
            </button>
          )}
        </section>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
