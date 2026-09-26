"use client";

import type { JSX } from "react";

import { errorText } from "./billing";

// One place that renders failed requests. Billing is currently disabled in the
// product UI, so errors stay factual and never present upgrade/sales prompts.
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
  return (
    <p role={role}>
      {errorText(error, fallback)}
    </p>
  );
}
