"use client";

import * as React from "react";
import type { QueryClient } from "@tanstack/react-query";

import { apiFetch } from "../lib/api";
import {
  shouldShowWorkspaceTour,
  workspaceTourLocalKey,
  type WorkspaceTourProfile,
} from "../lib/app-shell-behavior";

export function useWorkspaceTour<T extends WorkspaceTourProfile>(
  profile: T | undefined,
  queryClient: QueryClient,
): {
  showTour: boolean;
  setShowTour: React.Dispatch<React.SetStateAction<boolean>>;
  dismissTour: () => Promise<void>;
} {
  const [showTour, setShowTour] = React.useState(false);

  React.useEffect(() => {
    const restartTour = (): void => setShowTour(true);
    window.addEventListener("nexpos:restart-tour", restartTour);
    return () => window.removeEventListener("nexpos:restart-tour", restartTour);
  }, []);

  React.useEffect(() => {
    if (!profile) return;
    const locallySeen = window.localStorage.getItem(workspaceTourLocalKey(profile.userId)) === "1";
    if (shouldShowWorkspaceTour(profile, locallySeen)) setShowTour(true);
  }, [profile]);

  async function dismissTour(): Promise<void> {
    setShowTour(false);
    if (!profile) return;
    window.localStorage.setItem(workspaceTourLocalKey(profile.userId), "1");
    queryClient.setQueryData(["me"], { ...profile, workspaceTourSeen: true });
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/me/tour/seen", {
        csrfToken: csrf.csrfToken,
        init: { method: "POST" },
      });
    } catch {
      // Local suppression keeps daily work uninterrupted if the preference write fails.
    }
  }

  return { showTour, setShowTour, dismissTour };
}
