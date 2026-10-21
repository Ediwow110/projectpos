"use client";

import type { JSX } from "react";

import { Panel, SectionHeader } from "./premium";
import { GhostButton, PrimaryButton } from "./ui";
import { planLimitNotice } from "../lib/billing";
import { scopesCopy, type MintedApiToken } from "../lib/api-tokens";

export type ApiTokenCopyState = "idle" | "copied" | "failed";

/**
 * A 402 PLAN_LIMIT is an entitlement answer, not a failure to retry, so it
 * renders as its own panel with the plan named instead of the generic
 * "could not create" line. Any other error returns null and the caller keeps
 * its ordinary error copy.
 */
export function PlanGateNotice({ error }: { error: unknown }): JSX.Element | null {
  const notice = planLimitNotice(error);
  if (!notice) return null;
  return (
    <Panel className="border-[#f1d6ad] bg-[#fff8ea] p-5">
      <p role="alert" className="text-sm font-semibold text-[var(--color-atlas-warning-strong)]">
        {notice.message}
      </p>
      <p className="mt-2 text-[13px] leading-6 text-[var(--color-atlas-muted-strong)]">
        NexPOS mints public API tokens only while the plan includes the API entitlement, and the server
        refused this request. Nothing was created — the name and scopes you chose are still in the form.
        Ask the account owner to move this business to an Enterprise plan, then mint again.
      </p>
    </Panel>
  );
}

/**
 * The only surface that ever shows a minted secret. It is presentational and
 * driven by in-memory state: the value is never written to storage, a URL, or
 * the ledger table.
 */
export function SecretShowOnce({
  token,
  copyState,
  onCopy,
  onDismiss,
}: {
  token: MintedApiToken;
  copyState: ApiTokenCopyState;
  onCopy: () => void;
  onDismiss: () => void;
}): JSX.Element {
  return (
    <Panel className="border-[#cfe9dc] bg-[#eaf7f0] p-5">
      <SectionHeader
        title="Token created — copy the secret now"
        description="The secret is shown once. The server keeps only its hash, so it cannot be retrieved again after this panel is closed."
      />
      <p className="mt-4 rounded-xl bg-white px-4 py-3 font-data text-[13px] break-all text-[var(--color-atlas-ink)]">
        {token.secret}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <PrimaryButton type="button" onClick={onCopy}>Copy token</PrimaryButton>
        <GhostButton type="button" onClick={onDismiss}>I have saved it</GhostButton>
      </div>
      {copyState === "copied" ? (
        <p role="status" className="mt-3 text-[13px] font-semibold text-[var(--color-atlas-verified)]">
          Copied to your clipboard.
        </p>
      ) : null}
      {copyState === "failed" ? (
        <p role="alert" className="mt-3 text-[13px] font-semibold text-[var(--color-danger)]">
          Couldn&rsquo;t copy the token — your browser blocked clipboard access. Select the secret above and copy it manually.
        </p>
      ) : null}
      <p className="mt-3 text-[12px] leading-5 text-[var(--color-atlas-muted-strong)]">
        Prefix {token.prefix} · Scopes: {scopesCopy(token.scopes) || "none"}. Closing this panel discards the
        secret; there is no way to display it a second time, so store it in your integration now.
      </p>
    </Panel>
  );
}
