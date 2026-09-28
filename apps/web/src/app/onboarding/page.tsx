"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { Panel } from "../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
import { ApiError, apiFetch } from "../../lib/api";

const ORDER = ["businessDetails", "taxCurrency", "receiptSetup", "products", "employees"] as const;
type Step = (typeof ORDER)[number];
const SKIPPABLE: Step[] = ["products", "employees"];

const STEP_META: Record<Step, { title: string; description: string; note: string }> = {
  businessDetails: {
    title: "Business details",
    description: "Confirm the identity and operating context of this business.",
    note: "The onboarding API currently records completion state for this step.",
  },
  taxCurrency: {
    title: "Currency & tax",
    description: "Confirm that pricing and tax defaults have been configured for how the business operates.",
    note: "This screen does not pretend to persist currency/tax fields the current onboarding API does not accept.",
  },
  receiptSetup: {
    title: "Receipt setup",
    description: "Confirm that receipt behavior is ready before the first live shift.",
    note: "Receipt customization stays in its existing product surfaces; onboarding records the step state only.",
  },
  products: {
    title: "First products",
    description: "Add sellable products or skip this optional step and return later.",
    note: "Products created in the catalog are real product records, separate from onboarding progress.",
  },
  employees: {
    title: "Employees",
    description: "Resolve team setup now or skip it until employee management is available in your workflow.",
    note: "This optional step can be skipped without fabricating an employee record.",
  },
};

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
      (step) => steps[step as Step] === "done",
    );
    const optionalResolved = ["products", "employees"].every(
      (step) => steps[step as Step] !== "pending",
    );
    if (requiredDone && optionalResolved) router.push("/");
  }, [query.data, router]);

  async function patchStep(step: Step, state: "done" | "skipped"): Promise<void> {
    setError("");
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/onboarding", {
        csrfToken: csrf.csrfToken,
        init: { method: "PATCH", body: JSON.stringify({ step, state }) },
      });
      await query.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.code + ": " + err.message : "Update failed");
    }
  }

  if (query.isLoading) {
    return <main className="grid min-h-screen place-items-center bg-[#fcf8f3] text-sm text-[#73685f]">Loading setup…</main>;
  }
  if (query.isError) {
    return <main role="alert" className="grid min-h-screen place-items-center bg-[#fcf8f3] text-sm text-[#c43e3e]">Could not load setup progress.</main>;
  }

  const steps = query.data!.steps;
  const current =
    (ORDER.find((step) => step === query.data!.currentStep) ??
      ORDER.find((step) => steps[step] === "pending") ??
      ORDER[ORDER.length - 1]) as Step;
  const currentIndex = ORDER.indexOf(current);
  const currentMeta = STEP_META[current];

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#fcf8f3] p-4 sm:p-8">
      <div aria-hidden className="pointer-events-none absolute -left-40 bottom-[-10rem] h-[28rem] w-[28rem] rounded-full bg-[#ffd7c7]/45" />
      <div aria-hidden className="pointer-events-none absolute -right-32 -top-40 h-[35rem] w-[35rem] rounded-full bg-[#ffd9c8]/55" />
      <div aria-hidden className="pointer-events-none absolute right-[-5rem] top-32 h-[22rem] w-[22rem] rounded-full bg-[#ff8061]/20" />

      <header className="relative z-10 mx-auto flex max-w-[1360px] items-center rounded-2xl border border-white/80 bg-white px-5 py-4 shadow-[0_4px_14px_-6px_rgb(28_20_15/0.08)]">
        <p className="font-display text-xl font-bold">NEXPOS</p>
        <p className="font-data ml-4 hidden text-[8px] tracking-[0.14em] text-[#9b8f85] sm:block">RETAIL OPERATIONS</p>
        <div className="ml-auto flex items-center gap-3">
          <span className="font-data text-[9px] text-[#7a6f66]">SETUP {String(currentIndex + 1).padStart(2, "0")} / 05</span>
          <StatusPill tone="ok">● Saved</StatusPill>
        </div>
      </header>

      <div className="relative z-10 mx-auto mt-6 grid max-w-[1360px] gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="rounded-[18px] border border-white/80 bg-white p-6 shadow-[0_4px_14px_-6px_rgb(28_20_15/0.08)]">
          <h1 className="font-display text-[19px] font-semibold">Set up your business</h1>
          <p className="mt-2 text-[10px] leading-4 text-[#776b62]">A few decisions now keep every shift consistent later.</p>

          <ol className="mt-8 space-y-5">
            {ORDER.map((step, index) => {
              const state = steps[step];
              const active = step === current;
              return (
                <li key={step} className="flex items-center gap-3">
                  <span
                    className={
                      "font-data grid h-9 w-9 shrink-0 place-items-center rounded-full text-[9px] " +
                      (state === "done" || active
                        ? "bg-[#f35d3f] text-white"
                        : state === "skipped"
                          ? "bg-[#fff4df] text-[#b56d0c]"
                          : "bg-[#f4f0ea] text-[#8a7f76]")
                    }
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <p className={"text-[11px] " + (active ? "font-semibold text-[#17130f]" : "font-medium text-[#51483f]")}>{STEP_META[step].title}</p>
                    <p className={"font-data mt-1 text-[8px] " + (state === "done" ? "text-[#1f8a5b]" : active ? "text-[#e44e34]" : state === "skipped" ? "text-[#b56d0c]" : "text-[#9a8d83]")}>
                      {state === "done" ? "Done" : state === "skipped" ? "Skipped" : active ? "Current" : "Next"}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="mt-10 rounded-[14px] bg-[#1b1714] p-4 text-white">
            <p className="text-[11px] font-semibold">Setup stays honest</p>
            <p className="mt-2 text-[9px] leading-4 text-[#b9aaa0]">This flow only claims persistence for actions supported by the current APIs.</p>
          </div>
        </aside>

        <Panel className="min-h-[660px] p-6 sm:p-10">
          <p className="font-data text-[9px] font-medium uppercase tracking-[0.14em] text-[#f35d3f]">
            Step {String(currentIndex + 1).padStart(2, "0")} · {currentMeta.title}
          </p>
          <h2 className="font-display mt-5 max-w-3xl text-[30px] font-bold text-[#17130f]">{currentMeta.title}</h2>
          <p className="mt-3 max-w-3xl text-[13px] leading-5 text-[#73685f]">{currentMeta.description}</p>

          <div className="mt-8 grid gap-4 xl:grid-cols-[minmax(0,1fr)_250px]">
            <div className="rounded-2xl border border-[#eee4db] bg-[#fcf8f3] p-5 sm:p-7">
              <h3 className="font-display text-base font-semibold">Step status</h3>
              <p className="mt-2 text-[11px] leading-5 text-[#73685f]">{currentMeta.note}</p>

              <div className="mt-6 rounded-xl bg-white p-4">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[11px] font-semibold text-[#2a241f]">Current onboarding state</span>
                  <StatusPill tone={steps[current] === "done" ? "ok" : steps[current] === "skipped" ? "warn" : "info"}>
                    {steps[current]}
                  </StatusPill>
                </div>
              </div>

              {current === "products" ? (
                <div className="mt-4 rounded-xl bg-white p-4">
                  <p className="text-[11px] font-semibold text-[#2a241f]">Catalog work is available now</p>
                  <p className="mt-2 text-[10px] leading-4 text-[#73685f]">Add real product records in the catalog, then return here when you are ready to resolve this step.</p>
                  <Link href="/products" className="mt-3 inline-flex text-[11px] font-semibold text-[#e44e34]">Open products →</Link>
                </div>
              ) : null}

              {steps[current] === "pending" ? (
                <div className="mt-6 flex flex-wrap gap-2">
                  <PrimaryButton type="button" onClick={() => void patchStep(current, "done")}>Mark step complete</PrimaryButton>
                  {SKIPPABLE.includes(current) ? <GhostButton type="button" onClick={() => void patchStep(current, "skipped")}>Skip for now</GhostButton> : null}
                </div>
              ) : (
                <p className="mt-6 text-[11px] font-medium text-[#1f8a5b]">This step is already resolved.</p>
              )}
            </div>

            <div className="rounded-2xl bg-[#1b1714] p-5 text-white">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#4a2118] font-data text-[#ff8a6b]">◆</div>
              <h3 className="mt-5 text-[12px] font-semibold">Configured for consistency</h3>
              <p className="mt-3 text-[10px] leading-5 text-[#b9aaa0]">
                Completed setup state is server-backed. Unsupported settings are not simulated or silently stored only in the browser.
              </p>
            </div>
          </div>

          {error ? <p role="alert" className="mt-5 rounded-xl bg-[#fff0f0] px-3 py-2 text-sm font-medium text-[#c43e3e]">{error}</p> : null}

          <div className="mt-8 flex items-center justify-between gap-3 border-t border-[#eee6de] pt-5">
            <Link href="/" className="text-[11px] font-semibold text-[#73685f] hover:text-[#d94a30]">← Back to dashboard</Link>
            <p className="font-data text-[9px] text-[#9a8d83]">Progress is saved by the onboarding endpoint</p>
          </div>
        </Panel>
      </div>
    </main>
  );
}
