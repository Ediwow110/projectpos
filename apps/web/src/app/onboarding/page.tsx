"use client";

import type { JSX } from "react";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../lib/api";

const ORDER = ["businessDetails", "taxCurrency", "receiptSetup", "products", "employees"] as const;
type Step = (typeof ORDER)[number];
const SKIPPABLE: Step[] = ["products", "employees"];

interface OnboardingState {
  currentStep: string;
  steps: Record<Step, "done" | "skipped" | "pending">;
}

async function loadOnboarding(): Promise<OnboardingState> {
  return apiFetch<OnboardingState>("/api/v1/onboarding");
}

export default function OnboardingPage(): JSX.Element {
  const router = useRouter();
  const [error, setError] = useState("");
  const query = useQuery({ queryKey: ["onboarding"], queryFn: loadOnboarding });

  useEffect(() => {
    if (!query.data) return;
    const { steps } = query.data;
    const requiredDone = ["businessDetails", "taxCurrency", "receiptSetup"].every(
      (s) => steps[s as Step] === "done",
    );
    const optionalResolved = ["products", "employees"].every(
      (s) => steps[s as Step] !== "pending",
    );
    if (requiredDone && optionalResolved) router.push("/");
  }, [query.data, router]);

  async function patch(step: Step, state: "done" | "skipped"): Promise<void> {
    setError("");
    try {
      await apiFetch("/api/v1/onboarding", {
        init: { method: "PATCH", body: JSON.stringify({ step, state }) },
      });
      await query.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Update failed");
    }
  }

  if (query.isLoading) return <main>Loading setup…</main>;
  if (query.isError) return <main role="alert">Could not load setup progress.</main>;
  const steps = query.data!.steps;

  return (
    <main>
      <h1>Set up your business</h1>
      <ol>
        {ORDER.map((step) => (
          <li key={step}>
            {step}: {steps[step]}
            {steps[step] === "pending" && (
              <>
                <button onClick={() => patch(step, "done")}>Mark done</button>
                {SKIPPABLE.includes(step) && (
                  <button onClick={() => patch(step, "skipped")}>Skip for now</button>
                )}
              </>
            )}
          </li>
        ))}
      </ol>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
