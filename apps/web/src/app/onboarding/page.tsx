"use client";

import type { FormEvent, JSX } from "react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Panel } from "../../components/premium";
import { NexposLogo } from "../../components/brand/NexposLogo";
import { GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
import { ApiError, apiFetch } from "../../lib/api";
import { BusinessDetailsForm, type BusinessContactSettings } from "./BusinessDetailsForm";
import { ReceiptSetupForm, type ReceiptCopySettings } from "./ReceiptSetupForm";

const ORDER = ["businessDetails", "taxCurrency", "receiptSetup", "products", "employees"] as const;
type Step = (typeof ORDER)[number];
const REQUIRED: readonly Step[] = ["businessDetails", "taxCurrency", "receiptSetup"];
const OPTIONAL: readonly Step[] = ["products", "employees"];
const SKIPPABLE: Step[] = ["products", "employees"];

const STEP_META: Record<Step, { title: string; description: string; note: string }> = {
  businessDetails: {
    title: "Business details",
    description: "Confirm the business identity and save its operating contact information.",
    note: "The registered business name is fixed; its operating address and optional contact number are saved to business settings.",
  },
  taxCurrency: {
    title: "Currency & tax",
    description: "Confirm that pricing and tax defaults have been configured for how the business operates.",
    note: "Currency and tax settings are saved to your business before this step is completed.",
  },
  receiptSetup: {
    title: "Receipt setup",
    description: "Review your business receipt format before the first live shift.",
    note: "Standard receipt formatting is available now; optional header and footer changes use the existing plan-gated settings.",
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
  const state = await apiFetch<unknown>("/api/v1/onboarding");
  if (typeof state !== "object" || state === null || !("steps" in state) ||
      typeof state.steps !== "object" || state.steps === null ||
      !ORDER.every((step) => {
        const value = (state.steps as Record<string, unknown>)[step];
        return value === "done" || value === "pending" || (SKIPPABLE.includes(step) && value === "skipped");
      })) {
    throw new ApiError("INVALID_RESPONSE", "Setup progress was invalid.", "", 200);
  }
  return state as unknown as OnboardingState;
}

interface TaxSettings {
  currency: string;
  taxName: string;
  taxRateBps: number;
}

function TaxCurrencyForm({
  saving,
  onSave,
}: {
  saving: boolean;
  onSave: (settings: TaxSettings) => void;
}): JSX.Element {
  const business = useQuery({
    queryKey: ["onboarding", "business-settings"],
    queryFn: () => apiFetch<{ currency: string; settings: Record<string, unknown> }>("/api/v1/business"),
    retry: false,
  });
  const [currency, setCurrency] = useState("PHP");
  const [taxName, setTaxName] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    const settings = business.data?.settings;
    if (!settings) return;
    if (typeof business.data?.currency === "string") setCurrency(business.data.currency);
    if (typeof settings["taxName"] === "string") setTaxName(settings["taxName"]);
    if (typeof settings["taxRateBps"] === "number") setTaxRate(String(settings["taxRateBps"] / 100));
  }, [business.data]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const name = taxName.trim();
    const rate = taxRate.trim();
    if (!/^[A-Z]{3}$/.test(currency) || name.length === 0 || name.length > 80 ||
      !/^[0-9]{1,3}(\.[0-9]{1,2})?$/.test(rate) || Number(rate) > 100) {
      setValidationError("Enter a three-letter currency, a tax name and a tax rate from 0 to 100 with up to two decimal places.");
      return;
    }
    setValidationError("");
    onSave({ currency, taxName: name, taxRateBps: Math.round(Number(rate) * 100) });
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={submit}>
      <p className="text-[11px] leading-5 text-[#73685f]">Enter the tax rules that apply to your business. For tax-exempt sales, enter a descriptive name and 0%. No rate is assumed.</p>
      {business.isLoading ? <p role="status" className="text-xs text-[#73685f]">Loading saved business settings…</p> : null}
      {business.isError ? (
        <div role="alert" className="text-xs text-[#c43e3e]">
          Could not load saved business settings.
          <button type="button" className="ml-2 font-semibold underline" onClick={() => void business.refetch()}>Try again</button>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-[11px] font-semibold text-[#2a241f]">
          Currency (ISO code)
          <input className="field w-full" name="currency" value={currency} maxLength={3} required readOnly
            aria-label="Currency (ISO code)" aria-readonly="true" />
        </label>
        <label className="space-y-1 text-[11px] font-semibold text-[#2a241f]">
          Tax name
          <input className="field w-full" name="taxName" value={taxName} maxLength={80} required
            placeholder="VAT or No tax" onChange={(event) => setTaxName(event.target.value)} />
        </label>
        <label className="space-y-1 text-[11px] font-semibold text-[#2a241f]">
          Tax rate (%)
          <input className="field w-full" name="taxRate" type="number" min="0" max="100" step="0.01"
            value={taxRate} required placeholder="Enter a percentage" onChange={(event) => setTaxRate(event.target.value)} />
        </label>
      </div>
      <p className="text-[10px] leading-4 text-[#73685f]">Currency is fixed when the business is created to keep catalog prices and payments consistent.</p>
      {validationError ? <p role="alert" className="text-xs text-[#c43e3e]">{validationError}</p> : null}
      <PrimaryButton type="submit" disabled={saving || business.isLoading || business.isError} aria-busy={saving}>
        {saving ? "Saving currency & tax…" : "Save currency & tax"}
      </PrimaryButton>
    </form>
  );
}

export default function OnboardingPage(): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [savingStep, setSavingStep] = useState<Step | null>(null);
  const query = useQuery({ queryKey: ["onboarding"], queryFn: loadOnboarding, retry: false });
  const unauthorized = query.error instanceof ApiError && (query.error.status === 401 || query.error.status === 403);
  const requiredDone = query.data !== undefined && REQUIRED.every((step) => query.data.steps[step] === "done");
  const optionalResolved = query.data !== undefined && OPTIONAL.every((step) => query.data.steps[step] !== "pending");

  useEffect(() => {
    if (requiredDone && optionalResolved) router.push("/");
  }, [optionalResolved, requiredDone, router]);

  useEffect(() => {
    if (unauthorized) router.replace("/login");
  }, [router, unauthorized]);

  async function patchStep(
    step: Step,
    state: "done" | "skipped",
    options?: { businessDetails?: BusinessContactSettings; taxSettings?: TaxSettings; receiptCopy?: ReceiptCopySettings; receiptPreviewConfirmed?: boolean },
  ): Promise<void> {
    if (savingStep !== null) return;
    setError("");
    setSavingStep(step);
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      if (options?.businessDetails || options?.taxSettings || options?.receiptCopy) {
        await apiFetch("/api/v1/business/settings", {
          csrfToken: csrf.csrfToken,
          init: { method: "PATCH", body: JSON.stringify(options.businessDetails ?? options.taxSettings ?? options.receiptCopy) },
        });
      }
      await apiFetch("/api/v1/onboarding", {
        csrfToken: csrf.csrfToken,
        init: { method: "PATCH", body: JSON.stringify({
          step, state, ...(options?.receiptPreviewConfirmed ? { receiptPreviewConfirmed: true } : {}),
        }) },
      });
      await query.refetch();
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.code + ": " + err.message : "Update failed");
    } finally {
      setSavingStep(null);
    }
  }

  if (query.isLoading) {
    return <main className="grid min-h-screen place-items-center bg-[#fcf8f3] text-sm text-[#73685f]">Loading setup…</main>;
  }
  if (unauthorized) {
    return <main role="status" className="grid min-h-screen place-items-center bg-[#fcf8f3] text-sm text-[#73685f]">Returning to sign in…</main>;
  }
  if (query.isError || !query.data) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fcf8f3] p-6 text-center">
        <div>
          <p role="alert" className="text-sm text-[#c43e3e]">Could not load setup progress.</p>
          <button type="button" onClick={() => void query.refetch()} className="mt-4 text-sm font-semibold text-[#d94a30]">Try again</button>
        </div>
      </main>
    );
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
        <NexposLogo variant="light" size="md" />
        <div className="ml-auto flex items-center gap-3">
          <span className="font-data text-[9px] text-[#7a6f66]">SETUP {String(currentIndex + 1).padStart(2, "0")} / 05</span>
          <StatusPill tone="info">Setup in progress</StatusPill>
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

              {steps[current] === "pending" && current === "businessDetails" ? (
                <BusinessDetailsForm
                  saving={savingStep !== null}
                  onSave={(settings) => void patchStep("businessDetails", "done", { businessDetails: settings })}
                />
              ) : steps[current] === "pending" && current === "taxCurrency" ? (
                <TaxCurrencyForm
                  saving={savingStep !== null}
                  onSave={(settings) => void patchStep("taxCurrency", "done", { taxSettings: settings })}
                />
              ) : steps[current] === "pending" && current === "receiptSetup" ? (
                <ReceiptSetupForm
                  saving={savingStep !== null}
                  onConfirm={(receiptCopy) => void patchStep("receiptSetup", "done", {
                    receiptPreviewConfirmed: true,
                    ...(receiptCopy ? { receiptCopy } : {}),
                  })}
                />
              ) : steps[current] === "pending" ? (
                <div className="mt-6 flex flex-wrap gap-2">
                  <PrimaryButton
                    type="button"
                    onClick={() => void patchStep(current, "done")}
                    disabled={savingStep !== null}
                    aria-busy={savingStep !== null}
                  >
                    {savingStep !== null ? "Saving step…" : "Mark step complete"}
                  </PrimaryButton>
                  {SKIPPABLE.includes(current) ? (
                    <GhostButton
                      type="button"
                      onClick={() => void patchStep(current, "skipped")}
                      disabled={savingStep !== null}
                    >
                      {savingStep !== null ? "Please wait…" : "Skip for now"}
                    </GhostButton>
                  ) : null}
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
            {requiredDone
              ? <Link href="/" className="text-[11px] font-semibold text-[#73685f] hover:text-[#d94a30]">← Back to dashboard</Link>
              : <p className="text-[11px] font-medium text-[#73685f]">Complete required setup to open the dashboard.</p>}
            <p className="font-data text-[9px] text-[#9a8d83]">Progress is saved by the onboarding endpoint</p>
          </div>
        </Panel>
      </div>
    </main>
  );
}
