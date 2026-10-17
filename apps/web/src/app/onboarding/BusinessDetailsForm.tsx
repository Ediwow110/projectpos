"use client";

import type { FormEvent, JSX } from "react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { PrimaryButton } from "../../components/ui";
import { apiFetch } from "../../lib/api";

export interface BusinessContactSettings {
  businessAddress: string;
  businessPhone: string;
}

export function BusinessDetailsForm({
  saving,
  onSave,
}: {
  saving: boolean;
  onSave: (settings: BusinessContactSettings) => void;
}): JSX.Element {
  const business = useQuery({
    queryKey: ["onboarding", "business-details"],
    queryFn: () => apiFetch<{ name: string; settings: Record<string, unknown> }>("/api/v1/business"),
    retry: false,
  });
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    const settings = business.data?.settings;
    if (!settings) return;
    if (typeof settings["businessAddress"] === "string") setAddress(settings["businessAddress"]);
    if (typeof settings["businessPhone"] === "string") setPhone(settings["businessPhone"]);
  }, [business.data]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const cleanAddress = address.trim();
    const cleanPhone = phone.trim();
    if (cleanAddress.length < 5 || cleanAddress.length > 240 || cleanPhone.length > 40) {
      setValidationError("Enter an operating address of at least five characters; the optional phone must be under 40 characters.");
      return;
    }
    setValidationError("");
    onSave({ businessAddress: cleanAddress, businessPhone: cleanPhone });
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={submit}>
      <p className="text-[11px] leading-5 text-[#73685f]">
        Confirm the business you registered and save its operating contact information.
        This profile is not a substitute for any tax registration or government-issued permit.
      </p>
      {business.isLoading ? <p role="status" className="text-xs text-[#73685f]">Loading business details…</p> : null}
      {business.isError ? (
        <div role="alert" className="text-xs text-[#c43e3e]">
          Could not load the registered business.
          <button type="button" className="ml-2 font-semibold underline" onClick={() => void business.refetch()}>Try again</button>
        </div>
      ) : null}
      <label className="block space-y-1 text-[11px] font-semibold text-[#2a241f]">
        Registered business name
        <input className="field w-full" value={business.data?.name ?? ""} readOnly aria-readonly="true" />
      </label>
      <label className="block space-y-1 text-[11px] font-semibold text-[#2a241f]">
        Business address
        <textarea className="field w-full" value={address} maxLength={240} minLength={5}
          placeholder="Street or unit, barangay, city or municipality, province"
          required rows={3} onChange={(event) => setAddress(event.target.value)} />
      </label>
      <label className="block space-y-1 text-[11px] font-semibold text-[#2a241f]">
        Business contact phone (optional)
        <input className="field w-full" type="tel" value={phone} maxLength={40} autoComplete="tel"
          placeholder="Contact number" onChange={(event) => setPhone(event.target.value)} />
      </label>
      {validationError ? <p role="alert" className="text-xs text-[#c43e3e]">{validationError}</p> : null}
      <PrimaryButton type="submit" disabled={saving || business.isLoading || business.isError}
        aria-busy={saving}>
        {saving ? "Saving business details…" : "Save business details"}
      </PrimaryButton>
    </form>
  );
}
