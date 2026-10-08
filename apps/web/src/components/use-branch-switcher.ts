"use client";

import * as React from "react";
import type { QueryClient } from "@tanstack/react-query";

import { ApiError, apiFetch } from "../lib/api";
import { branchInvalidationPredicate } from "../lib/app-shell-behavior";

interface BranchProfile {
  activeBranchId: string | null;
  activeBranchName: string | null;
}

export function useBranchSwitcher<T extends BranchProfile>(
  profile: T | undefined,
  queryClient: QueryClient,
): {
  branchError: string;
  switchingBranch: boolean;
  switchBranch: (branchId: string) => Promise<void>;
} {
  const [branchError, setBranchError] = React.useState("");
  const [switchingBranch, setSwitchingBranch] = React.useState(false);

  async function switchBranch(branchId: string): Promise<void> {
    if (!profile || switchingBranch) return;
    setSwitchingBranch(true);
    setBranchError("");
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      const result = await apiFetch<{ activeBranchId: string | null; activeBranchName: string | null }>(
        "/api/v1/me/active-branch",
        {
          csrfToken: csrf.csrfToken,
          init: {
            method: "POST",
            body: JSON.stringify({ branchId: branchId || null }),
          },
        },
      );
      queryClient.setQueryData(["me"], {
        ...profile,
        activeBranchId: result.activeBranchId,
        activeBranchName: result.activeBranchName,
      });
      await queryClient.invalidateQueries({ predicate: branchInvalidationPredicate });
    } catch (error) {
      setBranchError(error instanceof ApiError ? error.message : "Could not switch branch.");
    } finally {
      setSwitchingBranch(false);
    }
  }

  return { branchError, switchingBranch, switchBranch };
}
