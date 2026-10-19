"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Panel } from "../../components/premium";
import { AtlasEntryBrand } from "../../components/AtlasEntryBrand";
import { GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
import { ApiError, apiFetch } from "../../lib/api";
import {
  formatTaxRate,
  readSavedBusinessSettings,
  type SaleReadiness,
} from "../../lib/sale-readiness";

const ORDER = ["businessDetails", "taxCurrency", "receiptSetup", "products", "employees"] as const;
type Step = (typeof ORDER)[number];
const REQUIRED: readonly Step[] = ["businessDetails", "taxCurrency", "receiptSetup"];
const OPTIONAL: readonly Step[] = ["products", "employees"];
const SKIPPABLE: Step[] = ["products", "employees"];

const STEP_META: Record<Step, { title: string; description: string; note: string }> = {
  businessDetails: {
    title: "Business details",
    description: "Confirm the business identity and save its operating contact information.",
    note: "Save your operating address, optional phone and timezone before continuing.",
  },
  taxCurrency: {
    title: "Currency & tax",
    description: "Confirm that pricing and tax defaults have been configured for how the business operates.",
    note: "Choose an explicit tax name and rate, including zero when applicable. These settings affect sales.",
  },
  receiptSetup: {
    title: "Receipt setup",
    description: "Confirm that receipt behavior is ready before the first live shift.",
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

interface BusinessDetails {
  name: string;
  currency: string;
  settings: Record<string, unknown>;
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
  const [receiptReviewed, setReceiptReviewed] = useState(false);
  const query = useQuery({ queryKey: ["onboarding"], queryFn: loadOnboarding, retry: false });
  const business = useQuery({ queryKey: ["onboarding-business"], queryFn: () => apiFetch<BusinessDetails>("/api/v1/business"), retry: false });
  const unauthorized = query.error instanceof ApiError && (query.error.status === 401 || query.error.status === 403);
  const requiredDone = query.data !== undefined && REQUIRED.every((step) => query.data.steps[step] === "done");
  const readiness = useQuery({
    queryKey: ["onboarding-sale-readiness"],
    queryFn: () => apiFetch<SaleReadiness>("/api/v1/onboarding/readiness"),
    retry: false,
  });

  useEffect(() => {
    if (!business.data) return;
    const s = business.data.settings;
    setBusinessAddress(typeof s["businessAddress"] === "string" ? s["businessAddress"] : "");
    setBusinessPhone(typeof s["businessPhone"] === "string" ? s["businessPhone"] : "");
    setBusinessTimezone(typeof s["businessTimezone"] === "string" ? s["businessTimezone"] : "Asia/Manila");
    setCurrency(business.data.currency);
    setTaxName(typeof s["taxName"] === "string" ? s["taxName"] : "");
    setTaxRatePercent(typeof s["taxRateBps"] === "number" ? String(s["taxRateBps"] / 100) : "");
    setReceiptHeader(typeof s["receiptHeader"] === "string" ? s["receiptHeader"] : "");
    setReceiptFooter(typeof s["receiptFooter"] === "string" ? s["receiptFooter"] : "");
    setReceiptReviewed(s["standardReceiptConfirmed"] === true);
  }, [business.data]);

  useEffect(() => {
    if (unauthorized) router.replace("/login");
  }, [router, unauthorized]);

  async function patchStep(
    step: Step,
    state: "done" | "skipped",
  ): Promise<void> {
    if (savingStep !== null) return;
    setError("");
    setSavingStep(step);
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      if (state === "done" && REQUIRED.includes(step)) {
        let payload: Record<string, string | number | boolean>;
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
          if (!receiptReviewed) {
            throw new Error("Review the receipt preview and confirm it before continuing.");
          }
          payload = { standardReceiptConfirmed: true };
          if (readiness.data?.canCustomizeReceipt) {
            payload = {
              ...payload,
              receiptHeader: receiptHeader.trim(),
              receiptFooter: receiptFooter.trim(),
            };
          }
        }
        await apiFetch("/api/v1/business/settings", {
          csrfToken: csrf.csrfToken,
          init: { method: "PATCH", body: JSON.stringify(payload) },
        });
      }
      const saved = await apiFetch<OnboardingState>("/api/v1/onboarding", {
        csrfToken: csrf.csrfToken,
        init: { method: "PATCH", body: JSON.stringify({
          step, state, ...(step === "receiptSetup" && state === "done" ? { receiptPreviewConfirmed: true } : {}),
        }) },
      });
      await query.refetch();
      await business.refetch();
      const reviewedReadiness = await readiness.refetch();
      setEditingStep(null);
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      if (editingStep === null &&
          REQUIRED.every((required) => saved.steps[required] === "done") &&
          OPTIONAL.every((optional) => saved.steps[optional] !== "pending") &&
          reviewedReadiness.data?.legacySetupReviewSteps?.length === 0) {
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
    return <main role="status" className="atlas-entry grid min-h-screen place-items-center text-sm text-[#748078]">Loading setup…</main>;
  }
  if (unauthorized) {
    return <main role="status" className="atlas-entry grid min-h-screen place-items-center text-sm text-[#748078]">Returning to sign in…</main>;
  }
  if (query.isError || !query.data || business.isError || !business.data) {
    return (
      <main className="atlas-entry grid min-h-screen place-items-center p-6 text-center">
        <div>
          <p role="alert" className="text-sm text-[#c43e3e]">Could not load setup progress.</p>
          <button type="button" onClick={() => void query.refetch()} className="mt-4 text-sm font-semibold text-[#d94a30]">Try again</button>
        </div>
      </main>
    );
  }

  const steps = query.data!.steps;
  const legacyReview = (readiness.data?.legacySetupReviewSteps ?? []) as Step[];
  const progressStep =
    (legacyReview[0] ??
      ORDER.find((step) => step === query.data!.currentStep) ??
      ORDER.find((step) => steps[step] === "pending") ??
      // A completed setup has no pending step: land on the first required step
      // so the owner reviews saved business settings instead of a skipped
      // optional step that says nothing.
      (REQUIRED.every((step) => steps[step] === "done") ? REQUIRED[0] : ORDER[ORDER.length - 1])) as Step;
  const current = editingStep ?? progressStep;
  const editingCompletedStep = (editingStep === current || legacyReview.includes(current)) && steps[current] === "done";
  const currentIndex = ORDER.indexOf(current);
  const currentMeta = STEP_META[current];
  const saved = readSavedBusinessSettings(business.data!);

  return (
    <main data-ui="atlas-v4-onboarding" className="atlas-entry min-h-screen p-4 sm:p-6 lg:p-8">

      <header className="mx-auto flex min-h-[77px] max-w-[1360px] flex-wrap items-center gap-3 rounded-xl border border-[#e5e9e3] bg-white px-5 py-3">
        <AtlasEntryBrand compact />
        <div className="ml-auto flex items-center gap-3">
          <span className="font-data text-[11px] text-[#748078]">STEP {String(currentIndex + 1).padStart(2, "0")} / 05</span>
          <span role="status" className="rounded-md bg-[#e8f4ec] px-3 py-1.5 text-[11px] font-semibold text-[#267552]">Setup progress</span>
        </div>
      </header>

      <div className="mx-auto mt-6 grid max-w-[1360px] gap-5 lg:grid-cols-[239px_minmax(0,1fr)]">
        <aside className="atlas-panel p-5 sm:p-6">
          <p className="atlas-eyebrow">BUSINESS WORKSPACE</p>
          <h1 className="font-display mt-4 text-[21px] font-semibold text-[#202826]">Set up your business</h1>
          <p className="mt-3 text-[13px] leading-5 text-[#748078]">Configure the essentials. We verify each saved step before you continue.</p>
          {legacyReview.length > 0 ? (
            <p role="status" className="mt-4 rounded-lg border border-[#f1c8a0] bg-[#fff9f0] p-3 text-[12px] leading-5 text-[#784724]">
              Earlier setup was marked done without saving {legacyReview.length} required step{legacyReview.length === 1 ? "" : "s"}.
              Review the highlighted step and save the real business settings.
            </p>
          ) : null}

          <ol className="mt-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            {ORDER.map((step, index) => {
              const state = steps[step];
              const active = step === current;
              return (
                <li key={step} className={"flex items-center gap-3 rounded-lg p-2.5 " + (active ? "bg-[#fff0eb]" : "bg-white")}>
                  <span
                    className={
                      "font-data grid h-9 w-9 shrink-0 place-items-center rounded-[9px] text-[11px] " +
                      (state === "done" || active
                        ? "bg-[#da614c] text-white"
                        : state === "skipped"
                          ? "bg-[#fff4df] text-[#b56d0c]"
                          : "bg-[#f7f8f5] text-[#748078]")
                    }
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <button type="button" className="min-h-11 flex-1 text-left disabled:cursor-default"
                    disabled={state !== "done" || savingStep !== null}
                    onClick={() => setEditingStep(step)}>
                    <p className={"text-[13px] " + (active ? "font-semibold text-[#202826]" : "font-medium text-[#526159]")}>{STEP_META[step].title}</p>
                    <p className={"font-data mt-1 text-[10px] " + (state === "done" ? "text-[#267552]" : active ? "text-[#da614c]" : state === "skipped" ? "text-[#9a6e32]" : "text-[#748078]")}>
                      {legacyReview.includes(step) ? "Review required · Missing saved settings" : state === "done" ? "Done · Select to review" : state === "skipped" ? "Skipped" : active ? "Current" : "Next"}
                    </p>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="mt-8 rounded-xl border border-[#e5e9e3] bg-[#fbfcfa] p-4">
            <p className="text-[13px] font-semibold text-[#202826]">Verified setup progress</p>
            <p className="mt-2 text-[12px] leading-5 text-[#748078]">Completion requires saved configuration. Optional steps can be skipped without creating records.</p>
          </div>
        </aside>

        <Panel className="atlas-panel min-h-[660px] min-w-0 p-5 sm:p-8 lg:p-10">
          <p className="atlas-eyebrow">
            Step {String(currentIndex + 1).padStart(2, "0")} · {currentMeta.title}
          </p>
          <h2 className="font-display mt-5 max-w-3xl text-[30px] font-semibold text-[#202826]">{currentMeta.title}</h2>
          <p className="mt-3 max-w-3xl text-[14px] leading-6 text-[#748078]">{currentMeta.description}</p>
          {editingCompletedStep ? <button type="button" className="mt-3 text-xs font-semibold text-[#e44e34]"
            onClick={() => setEditingStep(null)}>← Return to current setup</button> : null}

          {requiredDone ? (
            <section aria-label="Saved business settings" className="mt-6 rounded-xl border border-[#e5e9e3] bg-white p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-display text-[17px] font-semibold text-[#202826]">Saved business settings</h3>
                <p className="font-data text-[10px] tracking-wide text-[#53615a]">SAVED ON THE SERVER</p>
              </div>
              <dl className="mt-4 grid gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-[11px] font-medium text-[#53615a]">Business details</dt>
                  <dd className="mt-1 text-[13px] font-semibold text-[#202826]">{saved.name}</dd>
                  <dd className="mt-1 text-[12px] leading-5 text-[#53615a]">{saved.address || "No address saved"}</dd>
                  {saved.phone ? <dd className="text-[12px] leading-5 text-[#53615a]">{saved.phone}</dd> : null}
                  <dd className="text-[12px] leading-5 text-[#53615a]">{saved.timezone || "No timezone saved"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-[#53615a]">Currency &amp; tax</dt>
                  <dd className="mt-1 text-[13px] font-semibold text-[#202826]">
                    {saved.currency} · {saved.taxName || "No tax name saved"}
                  </dd>
                  <dd className="mt-1 text-[12px] leading-5 text-[#53615a]">{formatTaxRate(saved.taxRateBps)} tax rate</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-[#53615a]">Receipt setup</dt>
                  <dd className="mt-1 text-[13px] font-semibold text-[#202826]">
                    {saved.receiptConfirmed ? "Standard receipt confirmed" : "Standard receipt not confirmed"}
                  </dd>
                  {readiness.data?.canCustomizeReceipt && (saved.receiptHeader || saved.receiptFooter) ? (
                    <dd className="mt-1 text-[12px] leading-5 text-[#53615a]">
                      {saved.receiptHeader ? `Header: ${saved.receiptHeader}` : "No custom header saved"}
                      <br />
                      {saved.receiptFooter ? `Footer: ${saved.receiptFooter}` : "No custom footer saved"}
                    </dd>
                  ) : null}
                </div>
              </dl>
            </section>
          ) : null}

          <div className="mt-8 grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px]">
            <div className="rounded-xl border border-[#e5e9e3] bg-[#fbfcfa] p-5 sm:p-7">
              <h3 className="font-display text-lg font-semibold text-[#202826]">Configuration</h3>
              <p className="mt-2 text-[13px] leading-5 text-[#748078]">{currentMeta.note}</p>

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
                    <input className="field mt-2 block w-full" value={currency} readOnly aria-readonly="true" />
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
                  <p className="text-xs text-[#73685f]">Standard receipt included: your registered business name, server-generated receipt number and transaction totals. Confirm it to complete setup; an upgraded plan is not required.</p>
                  {readiness.data?.canCustomizeReceipt ? (
                    <>
                      <label className="text-xs font-medium">Receipt header (optional customization)
                        <input className="field mt-2 block w-full" value={receiptHeader} maxLength={200} onChange={(e) => setReceiptHeader(e.target.value)} placeholder={business.data.name} />
                      </label>
                      <label className="text-xs font-medium">Receipt footer (optional customization)
                        <textarea className="field mt-2 block w-full" value={receiptFooter} maxLength={200} onChange={(e) => setReceiptFooter(e.target.value)} />
                      </label>
                    </>
                  ) : null}
                  {readiness.data && !readiness.data.canCustomizeReceipt ? (
                    <p className="text-xs text-[#73685f]">Optional custom header and footer are available on plans with receipt customization. Standard receipts remain available on Free.</p>
                  ) : null}
                  <div className="rounded-lg border border-dashed bg-white p-4 text-center text-xs">
                    <p className="mb-3 font-semibold">Receipt preview</p>
                    <p className="font-semibold">{business.data.name}</p>
                    {readiness.data?.canCustomizeReceipt && receiptHeader ? <p className="mt-1">{receiptHeader}</p> : null}
                    <p className="mt-2">Automatic receipt number — generated when the sale is completed.</p>
                    <p className="mt-2">Illustrative preview — monetary amounts and tax are calculated at sale time. This is not a regulatory compliance certification.</p>
                    {readiness.data?.canCustomizeReceipt && receiptFooter ? <p className="mt-2">{receiptFooter}</p> : null}
                  </div>
                  <label className="flex items-start gap-3 text-xs leading-5 text-[#202826]">
                    <input type="checkbox" className="mt-1" checked={receiptReviewed}
                      onChange={(event) => setReceiptReviewed(event.target.checked)} />
                    I reviewed the receipt details and confirm the standard receipt for this business.
                  </label>
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
                    className="atlas-step-action"
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
                <p className="mt-6 text-[11px] font-medium text-[#1f8a5b]">
                  {steps[current] === "done"
                    ? "This step is complete. Saved values are shown above; use the list to change them."
                    : "This step is already resolved."}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-[#e5e9e3] bg-white p-5 text-[#202826]">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#29332d] font-data text-white">N</div>
              <h3 className="mt-5 text-[15px] font-semibold">Configured for consistency</h3>
              <p className="mt-3 text-[12px] leading-5 text-[#748078]">
                Completed setup state is server-backed. Unsupported settings are not simulated or silently stored only in the browser.
              </p>
            </div>
          </div>

          {requiredDone ? (
            <div className="mt-6 rounded-xl border border-[#e5e9e3] bg-[#fbfcfa] p-5" aria-label="First sale readiness">
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
