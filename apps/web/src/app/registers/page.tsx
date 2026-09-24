"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import { errorText, planLimitNotice } from "../../lib/billing";
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
  branchId: string | null;
  branchName: string | null;
}

interface BranchRow {
  id: string;
  name: string;
}

export default function RegistersPage(): JSX.Element {
  const [name, setName] = useState("");
  const [branchId, setBranchId] = useState("");
  const [error, setError] = useState("");
  const [limited, setLimited] = useState(false);
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiFetch<{ items: BranchRow[] }>("/api/v1/branches"),
    retry: false,
  });
  const listQuery = useQuery({
    queryKey: ["registers"],
    queryFn: () => apiFetch<{ items: RegisterRow[] }>("/api/v1/registers"),
    retry: false,
  });

  const manageable = canManageRegisters(meQuery.data?.role ?? "cashier");

  async function mutate(path: string, init: RequestInit): Promise<void> {
    setError("");
    setLimited(false);
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch(path, { csrfToken: csrf.csrfToken, init });
      await listQuery.refetch();
    } catch (err) {
      setLimited(planLimitNotice(err) !== null);
      setError(errorText(err, "Update failed"));
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
              {r.branchName ? ` — ${r.branchName}` : ""}
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
            void mutate("/api/v1/registers", {
              method: "POST",
              body: JSON.stringify({ name, branchId: branchId === "" ? undefined : branchId }),
            }).then(() => {
              setName("");
              setBranchId("");
            });
          }}
        >
          <label>
            Register name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Counter 1" />
          </label>
          <label>
            Branch
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">No branch</option>
              {(branchesQuery.data?.items ?? []).map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
          <button type="submit">Create register</button>
        </form>
      ) : (
        <p>Only owners and managers can manage registers.</p>
      )}
      {error !== "" && (
        <p role="alert">
          {error}
          {limited && <> <Link href="/billing">Manage plan</Link></>}
        </p>
      )}
    </main>
  );
}
