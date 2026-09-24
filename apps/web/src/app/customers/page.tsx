"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import { RequestError } from "../../lib/billing-ui";
import { canManageCustomers, customerLabel } from "../../lib/customers";

interface Me {
  role: string;
}

interface Csrf {
  csrfToken: string;
}

interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  isActive: boolean;
}

export default function CustomersPage(): JSX.Element {
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<unknown>(null);

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const listQuery = useQuery({
    queryKey: ["customers", q],
    queryFn: () => apiFetch<{ items: CustomerRow[]; total: number }>(
      "/api/v1/customers?" + new URLSearchParams({ q, active: "true", page: "1", pageSize: "20" }).toString(),
    ),
    retry: false,
  });

  const manageable = canManageCustomers(meQuery.data?.role ?? "cashier");

  async function create(): Promise<void> {
    setError(null);
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/customers", {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          body: JSON.stringify({
            name,
            ...(phone.trim() !== "" ? { phone: phone.trim() } : {}),
          }),
        },
      });
      setName("");
      setPhone("");
      await listQuery.refetch();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <main>
      <Link href="/">Back to dashboard</Link>
      <h1>Customers</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void listQuery.refetch();
        }}
      >
        <label>
          Search name, phone, or email
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ana, 0917" />
        </label>
        <button type="submit">Search</button>
      </form>
      {listQuery.data && listQuery.data.items.length === 0 && <p>No customers found.</p>}
      <ul>
        {(listQuery.data?.items ?? []).map((c) => (
          <li key={c.id}>
            <Link href={"/customers/" + c.id}>{customerLabel(c)}</Link>
            {c.isActive ? "" : " (archived)"}
          </li>
        ))}
      </ul>
      <section aria-label="New customer">
        <h2>New customer</h2>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </label>
        <label>
          Phone (optional)
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
        </label>
        <button onClick={() => void create()} disabled={name.trim() === ""}>
          Create customer
        </button>
      </section>
      {!manageable && <p>Only owners and managers can edit or archive customers.</p>}
      <RequestError error={error} fallback="Create failed" />
      <RequestError error={listQuery.isError ? listQuery.error : null} fallback="Could not load customers." />
    </main>
  );
}
