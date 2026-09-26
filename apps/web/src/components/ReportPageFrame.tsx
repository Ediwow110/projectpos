"use client";

import type { JSX, ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "../lib/api";
import { AppShell } from "./AppShell";
import { PageHeader } from "./premium";

interface Me {
  role: string;
  businessName?: string;
}

export function ReportPageFrame({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description: string;
  children: ReactNode;
  actions?: ReactNode;
}): JSX.Element {
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Reports / Operational analysis"
          title={title}
          description={description}
          actions={
            <>
              <Link href="/reports/sales" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">← Reports</Link>
              {actions}
            </>
          }
        />
        {children}
      </main>
    </AppShell>
  );
}
