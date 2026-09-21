"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";

interface Me {
  userId: string;
  businessId: string;
  businessName: string;
  role: string;
}

export default function DashboardPage(): JSX.Element {
  const query = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<Me>("/api/v1/me"),
    retry: false,
  });

  if (query.isLoading) return <main>Loading…</main>;
  if (query.isError)
    return (
      <main>
        <h1>Sign in required</h1>
        <Link href="/login">Go to sign in</Link>
      </main>
    );

  return (
    <main>
      <h1>{query.data!.businessName}</h1>
      <p>Signed in as {query.data!.role}</p>
      <section>
        <h2>Getting started</h2>
        <ul>
          <li>
            <Link href="/onboarding">Continue setup</Link>
          </li>
          <li>
            <Link href="/products">Products</Link>
          </li>
          <li>Sales — coming in Phase 4</li>
          <li>Team — coming in a later phase</li>
        </ul>
      </section>
    </main>
  );
}
