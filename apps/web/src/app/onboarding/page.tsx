"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Panel } from "../../components/premium";
import { NexposLogo } from "../../components/brand/NexposLogo";
import { GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
import { ApiError, apiFetch } from "../../lib/api";

const ORDER = ["businessDetails", "taxCurrency", "receiptSetup", "products", "employees"] as const;
type Step = (typeof ORDER)[number];
const REQUIRED: readonly Step[] = ["businessDetails", "taxCurrency", "receiptSetup"];
const OPTIONAL: readonly Step[] = ["products", "employees"];
const SKIPPABLE: Step[] = ["products", "employees"];

const STEP_META: Record<Step, { title: string; description: string; note: string }> = {
  businessDetails: {
    title: "Business details",
    description: "Confirm the identity and operating context of this business.",
    note: "Save your operating address and timezone before continuing.",
  },
  taxCurrency: {
    title: "Currency & tax",
    description: "Confirm that pricing and tax defaults have been configured for how the business operates.",
    note: "Choose an explicit tax name and rate, including zero when applicable. These settings affect sales.",
  },
  receiptSetup: {
    title: "Receipt setup",
    description: "Confirm that receipt behavior is ready before the first live shift.",
    note: "Choose the text printed on receipts and preview it before opening your store.",
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

interface BusinessDetails {
  name: string;
  settings: Record<string, unknown>;
}

interface SaleReadiness {
  businessConfigured: boolean;
  hasSellableProduct: boolean;
  hasActiveRegister: boolean;
  hasOpenShift: boolean;
  hasStaff: boolean;
  readyForFirstSale: boolean;
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

export default function OnboardingPage(): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [savingStep, setSavingStep] = useState<Step | null>(null);
  const [editingStep, setEditingStep] = useState<Step | null>(null);
  const [businessAddress, setBusinessAddress] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [businessTimezone, setBusinessTimezone] = useState("Asia/Manila");
  const [currency, setCurrency] = useState("PHP");
  const [taxName, setTaxName] = useState("");
  const [taxRatePercent, setTaxRatePercent] = useState("");
  const [receiptHeader, setReceiptHeader] = useState("");
  const [receiptFooter, setReceiptFooter] = useState("");
  const query = useQuery({ queryKey: ["onboarding"], queryFn: loadOnboarding, retry: false });
  const business = useQuery({ queryKey: ["onboarding-business"], queryFn: () => apiFetch<BusinessDetails>("/api/v1/business"), retry: false });
  const unauthorized = query.error instanceof ApiError && (query.error.status === 401 || query.error.status === 403);
  const requiredDone = query.data !== undefined && REQUIRED.every((step) => query.data.steps[step] === "done");
  const readiness = useQuery({
    queryKey: ["onboarding-sale-readiness"],
    queryFn: () => apiFetch<SaleReadiness>("/api/v1/onboarding/readiness"),
    enabled: requiredDone,
    retry: false,
  });

  useEffect(() => {
    if (!business.data) return;
    const s = business.data.settings;
    setBusinessAddress(typeof s["businessAddress"] === "string" ? s["businessAddress"] : "");
    setBusinessPhone(typeof s["businessPhone"] === "string" ? s["businessPhone"] : "");
    setBusinessTimezone(typeof s["businessTimezone"] === "string" ? s["businessTimezone"] : "Asia/Manila");
    setCurrency(typeof s["currency"] === "string" ? s["currency"] : "PHP");
    setTaxName(typeof s["taxName"] === "string" ? s["taxName"] : "");
    setTaxRatePercent(typeof s["taxRateBps"] === "number" ? String(s["taxRateBps"] / 100) : "");
    setReceiptHeader(typeof s["receiptHeader"] === "string" ? s["receiptHeader"] : "");
    setReceiptFooter(typeof s["receiptFooter"] === "string" ? s["receiptFooter"] : "");
  }, [business.data]);

  useEffect(() => {
    if (unauthorized) router.replace("/login");
  }, [router, unauthorized]);

  async function patchStep(step: Step, state: "done" | "skipped"): Promise<void> {
    if (savingStep !== null) return;
    setError("");
    setSavingStep(step);
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      if (state === "done" && REQUIRED.includes(step)) {
        let payload: Record<string, string | number>;
        if (step === "businessDetails") {
          if (businessAddress.trim().length < 5 || businessTimezone.trim().length < 3) {
            throw new Error("Enter a valid business address and timezone.");
          }
          payload = { businessAddress: businessAddress.trim(), businessPhone: businessPhone.trim(), businessTimezone };
        } else if (step === "taxCurrency") {
          const rate = Number(taxRatePercent);
          const bps = Math.round(rate * 100);
          if (taxRatePercent.trim() === "" || !Number.isFinite(rate) ||
              Math.abs(rate * 100 - bps) > 0.000001 || rate < 0 || rate > 100 || !taxName.trim()) {
            throw new Error("Select a tax name and an explicit rate from 0 to 100%.");
          }
          payload = { currency, taxName: taxName.trim(), taxRateBps: bps };
        } else {
          if (!receiptHeader.trim()) throw new Error("Enter a receipt header to continue.");
          payload = { receiptHeader: receiptHeader.trim(), receiptFooter: receiptFooter.trim() };
        }
        await apiFetch("/api/v1/business/settings", {
          csrfToken: csrf.csrfToken,
          init: { method: "PATCH", body: JSON.stringify(payload) },
        });
      }
      const saved = await apiFetch<OnboardingState>("/api/v1/onboarding", {
        csrfToken: csrf.csrfToken,
        init: { method: "PATCH", body: JSON.stringify({ step, state }) },
      });
      await query.refetch();
      await business.refetch();
      await readiness.refetch();
      setEditingStep(null);
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      if (editingStep === null &&
          REQUIRED.every((required) => saved.steps[required] === "done") &&
          OPTIONAL.every((optional) => saved.steps[optional] !== "pending")) {
        router.push("/");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.code + ": " + err.message :
        err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingStep(null);
    }
  }

  if (query.isLoading || business.isLoading) {
    return <main className="grid min-h-screen place-items-center bg-[#fcf8f3] text-sm text-[#73685f]">Loading setup…</main>;
  }
  if (unauthorized) {
    return <main role="status" className="grid min-h-screen place-items-center bg-[#fcf8f3] text-sm text-[#73685f]">Returning to sign in…</main>;
  }
  if (query.isError || !query.data || business.isError || !business.data) {
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
  const progressStep =
    (ORDER.find((step) => step === query.data!.currentStep) ??
      ORDER.find((step) => steps[step] === "pending") ??
      ORDER[ORDER.length - 1]) as Step;
  const current = editingStep ?? progressStep;
  const editingCompletedStep = editingStep === current && steps[current] === "done";
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
          <StatusPill tone="info">● Setup progress</StatusPill>
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
                  <button type="button" className="min-h-11 flex-1 text-left disabled:cursor-default"
                    disabled={state !== "done" || savingStep !== null}
                    onClick={() => setEditingStep(step)}>
                    <p className={"text-[11px] " + (active ? "font-semibold text-[#17130f]" : "font-medium text-[#51483f]")}>{STEP_META[step].title}</p>
                    <p className={"font-data mt-1 text-[8px] " + (state === "done" ? "text-[#1f8a5b]" : active ? "text-[#e44e34]" : state === "skipped" ? "text-[#b56d0c]" : "text-[#9a8d83]")}>
                      {state === "done" ? "Done · Select to review" : state === "skipped" ? "Skipped" : active ? "Current" : "Next"}
                    </p>
                  </button>
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
          {editingCompletedStep ? <button type="button" className="mt-3 text-xs font-semibold text-[#e44e34]"
            onClick={() => setEditingStep(null)}>← Return to current setup</button> : null}

          <div className="mt-8 grid gap-4 xl:grid-cols-[minmax(0,1fr)_250px]">
            <div className="rounded-2xl border border-[#eee4db] bg-[#fcf8f3] p-5 sm:p-7">
              <h3 className="font-display text-base font-semibold">Step status</h3>
              <p className="mt-2 text-[11px] leading-5 text-[#73685f]">{currentMeta.note}</p>

              {current === "businessDetails" && (steps[current] === "pending" || editingCompletedStep) ? (
                <div className="mt-5 grid gap-4">
                  <p className="text-sm font-semibold">Business: {business.data.name}</p>
                  <label className="text-xs font-medium">Operating address
                    <textarea className="field mt-2 block w-full" value={businessAddress} maxLength={240}
                      onChange={(e) => setBusinessAddress(e.target.value)} placeholder="Street, city, province" />
                  </label>
                  <label className="text-xs font-medium">Business phone (optional)
                    <input className="field mt-2 block w-full" value={businessPhone} maxLength={40} onChange={(e) => setBusinessPhone(e.target.value)} />
                  </label>
                  <label className="text-xs font-medium">Operating timezone
                    <select className="field mt-2 block w-full" value={businessTimezone} onChange={(e) => setBusinessTimezone(e.target.value)}>
                      <option value="Asia/Manila">Philippines (Asia/Manila)</option>
                      <option value="Asia/Singapore">Singapore (Asia/Singapore)</option>
                      <option value="UTC">UTC</option>
                    </select>
                  </label>
                </div>
              ) : null}
              {current === "taxCurrency" && (steps[current] === "pending" || editingCompletedStep) ? (
                <div className="mt-5 grid gap-4">
                  <label className="text-xs font-medium">Currency
                    <select className="field mt-2 block w-full" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                      <option value="PHP">Philippine peso (PHP)</option>
                    </select>
                  </label>
                  <label className="text-xs font-medium">Tax name (e.g. VAT, non-VAT, no tax)
                    <input className="field mt-2 block w-full" maxLength={80} value={taxName} onChange={(e) => setTaxName(e.target.value)} placeholder="Choose the correct classification for your business" />
                  </label>
                  <label className="text-xs font-medium">Tax rate (%) — enter 0 explicitly if applicable
                    <input className="field mt-2 block w-full" type="number" min="0" max="100" step="0.01" value={taxRatePercent} onChange={(e) => setTaxRatePercent(e.target.value)} />
                  </label>
                  <p className="text-xs text-[#73685f]">Confirm your applicable tax treatment with your accountant. NexPOS will not assume a tax rate for you.</p>
                </div>
              ) : null}
              {current === "receiptSetup" && (steps[current] === "pending" || editingCompletedStep) ? (
                <div className="mt-5 grid gap-4">
                  <label className="text-xs font-medium">Receipt header
                    <input className="field mt-2 block w-full" value={receiptHeader} maxLength={200} onChange={(e) => setReceiptHeader(e.target.value)} placeholder={business.data.name} />
                  </label>
                  <label className="text-xs font-medium">Receipt footer (optional)
                    <textarea className="field mt-2 block w-full" value={receiptFooter} maxLength={200} onChange={(e) => setReceiptFooter(e.target.value)} />
                  </label>
                  <div className="rounded-lg border border-dashed bg-white p-4 text-center text-xs">
                    <p className="font-semibold">{receiptHeader || business.data.name}</p>
                    <p className="mt-1">{businessAddress}</p>
                    <p className="mt-2">Sample receipt — amounts and identifiers are calculated by the server at sale time.</p>
                    <p className="mt-2">{receiptFooter}</p>
                  </div>
                </div>
              ) : null}

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
              {current === "employees" ? (
                <div className="mt-4 rounded-xl bg-white p-4">
                  <p className="text-xs font-semibold">Owner-only stores can skip employee setup.</p>
                  <Link href="/team" className="mt-2 inline-block text-xs font-semibold text-[#e44e34]">Open team management →</Link>
                </div>
              ) : null}

              {steps[current] === "pending" || editingCompletedStep ? (
                <div className="mt-6 flex flex-wrap gap-2">
                  {(REQUIRED.includes(current) || SKIPPABLE.includes(current)) ? <PrimaryButton
                    type="button"
                    onClick={() => void patchStep(current, "done")}
                    disabled={savingStep !== null || business.isFetching}
                    aria-busy={savingStep !== null}
                  >
                    {savingStep !== null ? "Saving configuration…" :
                      REQUIRED.includes(current) ? "Save & continue" :
                      current === "products" ? "Verify saved products & continue" : "Verify added employees & continue"}
                  </PrimaryButton> : null}
                  {SKIPPABLE.includes(current) && !editingCompletedStep ? (
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

          {requiredDone ? (
            <div className="mt-6 rounded-2xl border border-[#eee4db] bg-[#fcf8f3] p-5" aria-label="First sale readiness">
              <h3 className="text-sm font-semibold text-[#17130f]">Before your first sale</h3>
              <p className="mt-2 text-xs text-[#73685f]">Business setup and operational readiness are separate. These checks come from the server; stock and checkout rules are validated again when you sell.</p>
              {readiness.data ? (
                <ul className="mt-3 space-y-2 text-xs">
                  <li>{readiness.data.hasSellableProduct ? "✓" : "○"} <Link className="underline" href="/products">At least one sellable product with available stock (if tracked)</Link></li>
                  <li>{readiness.data.hasActiveRegister ? "✓" : "○"} <Link className="underline" href="/registers">Active register</Link></li>
                  <li>{readiness.data.hasOpenShift ? "✓" : "○"} <Link className="underline" href="/shifts">Open shift</Link></li>
                </ul>
              ) : <p className="mt-3 text-xs" role="status">{readiness.isError ? "Could not load sale readiness; retry after refresh." : "Checking sale readiness…"}</p>}
            </div>
          ) : null}

          {error ? <p role="alert" className="mt-5 rounded-xl bg-[#fff0f0] px-3 py-2 text-sm font-medium text-[#c43e3e]">{error}</p> : null}

          <div className="mt-8 flex items-center justify-between gap-3 border-t border-[#eee6de] pt-5">
            {requiredDone
              ? <Link href="/" className="text-[11px] font-semibold text-[#73685f] hover:text-[#d94a30]">← Back to dashboard</Link>
              : <p className="text-[11px] font-medium text-[#73685f]">Save your required business, tax and receipt settings to open the dashboard.</p>}
            <p className="font-data text-[9px] text-[#9a8d83]">Progress is saved by the onboarding endpoint</p>
          </div>
        </Panel>
      </div>
    </main>
  );
}
