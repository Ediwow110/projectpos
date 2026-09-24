"use client";

import type { JSX } from "react";

import Link from "next/link";
import { errorText, planLimitNotice } from "./billing";

// One place that renders any failed request: plan-limit breaches get upgrade
// copy plus a route to billing, everything else keeps the API's code:message.
export function RequestError({
  error,
  fallback,
  role = "alert",
}: {
  error: unknown;
  fallback: string;
  role?: "alert" | "status";
}): JSX.Element | null {
  if (error === null || error === undefined) return null;
  const limited = planLimitNotice(error) !== null;
  return (
    <p role={role}>
      {errorText(error, fallback)}{" "}
      {limited && <Link href="/billing">Manage plan</Link>}
    </p>
  );
}
