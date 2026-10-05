"use client";

import React, { type ChangeEvent, type FormEvent, type JSX } from "react";
import Link from "next/link";

import { SectionHeader } from "../../../components/premium";
import { PrimaryButton } from "../../../components/ui";
import {
  loyaltyExample,
  type LoyaltySettingsErrors,
  type LoyaltySettingsField,
  type LoyaltySettingsForm as LoyaltySettingsFormValues,
} from "../../../lib/loyalty-settings";

interface LoyaltySettingsFormProps {
  form: LoyaltySettingsFormValues;
  errors: LoyaltySettingsErrors;
  busy: boolean;
  noProgram: boolean;
  onChange: (field: keyof LoyaltySettingsFormValues, value: string | boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function FieldError({ id, message }: { id: string; message?: string }): JSX.Element | null {
  return message ? <p id={id} role="alert" className="mt-1.5 text-[11px] font-medium text-[#c43e3e]">{message}</p> : null;
}

function NumberField({
  id,
  label,
  description,
  value,
  onChange,
  error,
  placeholder,
  inputMode = "decimal",
}: {
  id: LoyaltySettingsField;
  label: string;
  description: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  placeholder: string;
  inputMode?: "decimal" | "numeric";
}): JSX.Element {
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;
  return (
    <div>
      <label htmlFor={id} className="text-[12px] font-semibold text-[#2a241f]">{label}</label>
      <p id={descriptionId} className="mt-1 text-[11px] leading-4 text-[#7a6f66]">{description}</p>
      <input
        id={id}
        name={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        inputMode={inputMode}
        aria-invalid={error ? "true" : "false"}
        aria-describedby={error ? `${descriptionId} ${errorId}` : descriptionId}
        className={`field mt-2 w-full ${error ? "border-[#c43e3e]" : ""}`}
      />
      <FieldError id={errorId} message={error} />
    </div>
  );
}

export function LoyaltySettingsForm({ form, errors, busy, noProgram, onChange, onSubmit }: LoyaltySettingsFormProps): JSX.Element {
  const example = loyaltyExample(form);
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <div className="flex items-start justify-between gap-4 rounded-xl border border-[#eee4db] bg-[#fcf8f3] p-4">
        <div>
          <label htmlFor="enabled" className="text-[13px] font-semibold text-[#2a241f]">Enable loyalty program</label>
          <p id="enabled-description" className="mt-1 max-w-xl text-[11px] leading-5 text-[#73685f]">When enabled, eligible completed sales can earn points and customers can redeem points at checkout.</p>
        </div>
        <input
          id="enabled"
          name="enabled"
          type="checkbox"
          checked={form.enabled}
          onChange={(event) => onChange("enabled", event.target.checked)}
          aria-label="Enable loyalty program"
          aria-describedby="enabled-description"
          className="mt-1 h-5 w-5 accent-[#f35d3f]"
        />
      </div>

      {noProgram ? <div role="status" className="rounded-xl border border-[#f1d6ad] bg-[#fff8ea] p-4 text-[12px] leading-5 text-[#8a5606]">No loyalty program is configured yet. Set the rules below; saving will create the first version without silently enabling it.</div> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <NumberField id="earnAmount" label="Spend amount" description="Currency spent for each earn rule step." value={form.earnAmount} onChange={(event) => onChange("earnAmount", event.target.value)} error={errors.earnAmount} placeholder="1.00" />
        <NumberField id="earnPoints" label="Earn points" description="Whole points awarded for the spend amount." value={form.earnPoints} onChange={(event) => onChange("earnPoints", event.target.value)} error={errors.earnPoints} placeholder="1" inputMode="numeric" />
        <NumberField id="redeemPoints" label="Redeem points" description="Whole points required for one redemption step." value={form.redeemPoints} onChange={(event) => onChange("redeemPoints", event.target.value)} error={errors.redeemPoints} placeholder="10" inputMode="numeric" />
        <NumberField id="redeemValue" label="Redeem value" description="Currency value returned for the redemption step." value={form.redeemValue} onChange={(event) => onChange("redeemValue", event.target.value)} error={errors.redeemValue} placeholder="1.00" />
        <NumberField id="minimumRedeemPoints" label="Minimum redemption" description="Optional minimum whole-point balance required to redeem." value={form.minimumRedeemPoints} onChange={(event) => onChange("minimumRedeemPoints", event.target.value)} error={errors.minimumRedeemPoints} placeholder="10" inputMode="numeric" />
      </div>

      <section aria-label="Live loyalty example" className="rounded-2xl border border-[#dce8ff] bg-[#f3f7ff] p-5">
        <SectionHeader title="Live example" description="This preview uses the values currently entered above." />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-white/80 p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#3468d4]">Earn</p><p className="mt-2 font-display text-[19px] font-semibold text-[#2b4f94]">{example.earn}</p></div>
          <div className="rounded-xl bg-white/80 p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#3468d4]">Redeem</p><p className="mt-2 font-display text-[19px] font-semibold text-[#2b4f94]">{example.redeem}</p></div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#eee4db] pt-4">
        <Link href="/admin" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 py-2.5 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">Cancel</Link>
        <PrimaryButton type="submit" disabled={busy}>{busy ? "Saving…" : "Save loyalty settings"}</PrimaryButton>
      </div>
    </form>
  );
}
