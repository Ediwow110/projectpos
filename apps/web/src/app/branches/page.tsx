"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../lib/api";
import { canManageBranches } from "../../lib/branches";

interface Me {
  role: string;
}

interface Csrf {
  csrfToken: string;
}

export interface BranchRow {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

export default function BranchesPage(): JSX.Element {
  const [name, setName] = useState("");
  const [type, setType] = useState("store");
  const [error, setError] = useState("");
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const listQuery = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiFetch<{ items: BranchRow[] }>("/api/v1/branches"),
    retry: false,
  });

  const manageable = canManageBranches(meQuery.data?.role ?? "cashier");

  async function mutate(path: string, init: RequestInit): Promise<void> {
    setError("");
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch(path, { csrfToken: csrf.csrfToken, init });
      await listQuery.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.code + ": " + err.message : "Update failed");
    }
  }

  return (
    <main>
      <Link href="/">Back to dashboard</Link>
      <h1>Branches</h1>
      {listQuery.isLoading && <p>Loading branches…</p>}
      {listQuery.data && (
        <ul>
          {listQuery.data.items.map((b) => (
            <li key={b.id} style={{ fontVariantNumeric: "tabular-nums" }}>
              {b.name} — {b.type}
              {b.isActive ? "" : " (archived)"}{" "}
              {manageable && b.isActive && (
                <button
                  onClick={() =>
                    void mutate("/api/v1/branches/" + b.id, {
                      method: "PATCH",
                      body: JSON.stringify({ isActive: false }),
                    })
                  }
                >
                  Archive
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {listQuery.data?.items.length === 0 && <p>No branches yet. Create the first location below.</p>}
      {manageable ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void mutate("/api/v1/branches", {
              method: "POST",
              body: JSON.stringify({ name, type }),
            }).then(() => {
              setName("");
              setType("store");
            });
          }}
        >
          <label>
            Branch name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="North store" />
          </label>
          <label>
            Type
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="store">Store</option>
              <option value="warehouse">Warehouse</option>
            </select>
          </label>
          <button type="submit">Create branch</button>
        </form>
      ) : (
        <p>Only owners and managers can manage branches.</p>
      )}
      {error !== "" && <p role="alert">{error}</p>}
    </main>
  );
}
