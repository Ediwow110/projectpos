"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../lib/api";
import { canEditCatalog } from "../../lib/catalog";

interface Category {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

interface Me {
  role: string;
}

interface Csrf {
  csrfToken: string;
}

export default function CategoriesPage(): JSX.Element {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const listQuery = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<{ items: Category[] }>("/api/v1/categories"),
    retry: false,
  });

  async function create(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/categories", {
        csrfToken: csrf.csrfToken,
        init: { method: "POST", body: JSON.stringify({ name }) },
      });
      setName("");
      await listQuery.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.code + ": " + err.message : "Create failed");
    }
  }

  if (listQuery.isLoading) return <main>Loading categories…</main>;
  if (listQuery.isError || !listQuery.data)
    return (
      <main>
        <p role="alert">Could not load categories.</p>
      </main>
    );

  const editable = meQuery.data ? canEditCatalog(meQuery.data.role) : false;

  return (
    <main>
      <Link href="/products">Back to products</Link>
      <h1>Categories</h1>
      <ul>
        {listQuery.data.items.map((c) => (
          <li key={c.id}>
            {c.name}
            {c.isActive ? "" : " (archived)"}
          </li>
        ))}
      </ul>
      {editable && (
        <form onSubmit={create}>
          <label>
            New category
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </label>
          <button type="submit">Add category</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
