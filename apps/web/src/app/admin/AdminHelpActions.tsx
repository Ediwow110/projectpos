"use client";

import type { JSX } from "react";

import { PrimaryButton } from "../../components/ui";

export function AdminHelpActions(): JSX.Element {
  return (
    <PrimaryButton
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("nexpos:restart-tour"))}
    >
      Restart system tour
    </PrimaryButton>
  );
}
