"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../lib/api";
import { canManageRegisters } from "../../lib/shifts";

interface Me {
  role: string;
}

interface Csrf {
  csrfToken: string;
}

interface RegisterRow {
  id: string;
  name: string;
  isActive: boolean;
}

export default function RegistersPage(): JSX.Element {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const listQuery = useQuery({
    queryKey: ["registers"],
    queryFn: () => apiFetch<{ items: RegisterRow[] }>("/api/v1/registers"),
    retry: false,
  });

  const manageable = canManageRegisters(meQuery.data?.role ?? "cashier");

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
      <h1>Registers</h1>
      {listQuery.isLoading && <p>Loading registers…</p>}
      {listQuery.data && (
        <ul>
          {listQuery.data.items.map((r) => (
            <li key={r.id}>
              {r.name}
              {r.isActive ? "" : " (archived)"}{" "}
              {manageable && r.isActive && (
                <button
                  onClick={() =>
                    void mutate("/api/v1/registers/" + r.id, {
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
      {listQuery.data?.items.length === 0 && <p>No registers yet. Create the first counter below.</p>}
      {manageable ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void mutate("/api/v1/registers", { method: "POST", body: JSON.stringify({ name }) }).then(() =>
              setName(""),
            );
          }}
        >
          <label>
            Register name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Counter 1" />
          </label>
          <button type="submit">Create register</button>
        </form>
      ) : (
        <p>Only owners and managers can manage registers.</p>
      )}
      {error !== "" && <p role="alert">{error}</p>}
    </main>
  );
}
