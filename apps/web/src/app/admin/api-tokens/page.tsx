"use client";

import type { JSX } from "react";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../../components/AppShell";
import { PlanGateNotice, SecretShowOnce, type ApiTokenCopyState } from "../../../components/ApiTokenPanels";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../../components/premium";
import { DangerButton, GhostButton, PrimaryButton, StatusPill } from "../../../components/ui";
import { ApiError, apiBase, apiFetch } from "../../../lib/api";
import { errorText, planLimitNotice } from "../../../lib/billing";
import {
  API_TOKEN_SCOPES,
  EXPIRING_SOON_DAYS,
  TOKEN_NAME_MAX,
  formatTokenDay,
  projectTokenRow,
  revokeApiToken,
  revokeConfirmation,
  scopeLabel,
  scopesCopy,
  submitApiToken,
  tokenStateCopy,
  tokenSummary,
  type ApiTokenDraft,
  type ApiTokenDraftErrors,
  type ApiTokenRow,
  type MintedApiToken,
} from "../../../lib/api-tokens";

interface Me {
  role: string;
  businessName?: string;
  permissions?: string[];
}

interface TokenList {
  items: unknown[];
}

const EMPTY_DRAFT: ApiTokenDraft = { name: "", scopes: [], expiresAt: "" };

type CopyState = ApiTokenCopyState;

export default function ApiTokensPage(): JSX.Element {
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const tokens = useQuery({
    queryKey: ["apitokens"],
    queryFn: () => apiFetch<TokenList>("/api/v1/apitokens"),
    retry: false,
  });

  const [draft, setDraft] = useState<ApiTokenDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<ApiTokenDraftErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [planError, setPlanError] = useState<unknown>(null);
  const [minted, setMinted] = useState<MintedApiToken | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [revoking, setRevoking] = useState<ApiTokenRow | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);

  // The list, mint, and revoke routes share one server guard (role owner or
  // manager). A ledger that answered is therefore the server's own signal that
  // this session may manage tokens; the client never re-derives eligibility
  // from a role name or a guessed permission key, and a 403 is rendered as the
  // refusal it is.
  const canManage = !tokens.isLoading && !tokens.isError && tokens.data !== undefined;
  const forbidden = tokens.error instanceof ApiError && tokens.error.code === "FORBIDDEN";
  const rows = (tokens.data?.items ?? []).map(projectTokenRow);
  const summary = tokenSummary(rows);
  const confirmation = revoking ? revokeConfirmation(revoking) : null;
  const curlExample = `curl -H "Authorization: Bearer <paste-once-secret>" "${apiBase()}/api/v1/sales?limit=50"`;

  function updateDraft(next: Partial<ApiTokenDraft>): void {
    setDraft((current) => ({ ...current, ...next }));
    setErrors({});
  }

  function toggleScope(scope: string): void {
    setDraft((current) => ({
      ...current,
      scopes: current.scopes.includes(scope)
        ? current.scopes.filter((item) => item !== scope)
        : [...current.scopes, scope],
    }));
    setErrors({});
  }

  async function createToken(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setErrors({});
    setError("");
    setPlanError(null);
    setBusy(true);
    try {
      // An invalid draft is reported here without a request reaching the API.
      const result = await submitApiToken(draft);
      if (result.kind === "invalid") {
        setErrors(result.errors);
        return;
      }
      setMinted(result.token);
      setCopyState("idle");
      setDraft(EMPTY_DRAFT);
      await tokens.refetch();
    } catch (cause) {
      if (planLimitNotice(cause)) setPlanError(cause);
      else setError(errorText(cause, "The token could not be created."));
    } finally {
      setBusy(false);
    }
  }

  async function copySecret(): Promise<void> {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.secret);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  function dismissSecret(): void {
    setMinted(null);
    setCopyState("idle");
  }

  async function confirmRevoke(): Promise<void> {
    if (!revoking || revokeBusy) return;
    setRevokeBusy(true);
    setError("");
    try {
      await revokeApiToken(revoking.id);
      setRevoking(null);
      await tokens.refetch();
    } catch (cause) {
      setRevoking(null);
      setError(errorText(cause, "The token could not be revoked."));
    } finally {
      setRevokeBusy(false);
    }
  }

  return (
    <AppShell businessName={me.data?.businessName} role={me.data?.role}>
      <main className="mx-auto w-full max-w-[1240px] space-y-5 px-4 pb-12 pt-6 sm:px-6">
        <PageHeader
          eyebrow="Admin / Integrations"
          title="API tokens"
          description="Mint and revoke the bearer tokens that call the public NexPOS API. Each token carries only the scopes it was given, and its secret is displayed exactly once."
        />

        {forbidden ? (
          <Panel className="border-[#efb9b9] bg-[#fff0f0] p-5">
            <p role="alert" className="text-sm font-medium text-[var(--color-danger)]">
              The server refused this request: token management is limited to the owner or manager role of this
              business. Your other workspace permissions are unchanged.
            </p>
          </Panel>
        ) : null}

        {!forbidden && tokens.isError ? (
          <Panel className="border-[#efb9b9] bg-[#fff0f0] p-5">
            <p role="alert" className="text-sm font-medium text-[var(--color-danger)]">
              {errorText(tokens.error, "The token ledger could not be loaded.")}
            </p>
            <div className="mt-3">
              <GhostButton type="button" onClick={() => void tokens.refetch()}>Retry</GhostButton>
            </div>
          </Panel>
        ) : null}

        {tokens.isLoading ? <p role="status" className="text-sm text-[var(--color-atlas-muted-strong)]">Loading API tokens…</p> : null}

        {canManage ? (
          <section aria-label="API token summary" className="grid gap-4 sm:grid-cols-3">
            <MetricCard label="Usable tokens" value={summary.usable} icon="◎" tone="info" meta="Not revoked and not past expiry" />
            <MetricCard label="Expiring soon" value={summary.expiringSoon} icon="◷" tone="warning" meta={`Inside ${EXPIRING_SOON_DAYS} days of expiry`} />
            <MetricCard label="Revoked" value={summary.revoked} icon="✕" tone="coral" meta="Rejected on every call" />
          </section>
        ) : null}

        {minted ? (
          <SecretShowOnce token={minted} copyState={copyState} onCopy={() => void copySecret()} onDismiss={dismissSecret} />
        ) : null}

        {planError ? <PlanGateNotice error={planError} /> : null}

        {error ? (
          <Panel className="border-[#efb9b9] bg-[#fff0f0] p-4">
            <p role="alert" className="text-sm font-medium text-[var(--color-danger)]">{error}</p>
          </Panel>
        ) : null}

        {canManage ? (
          <Panel className="p-5">
            <SectionHeader
              title="Create a token"
              description="Name the integration, tick the least access it needs, and optionally set an expiry. The secret appears once, immediately after creation."
            />
            <form onSubmit={createToken} className="mt-4 space-y-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                <label className="block text-[11px] font-semibold text-[var(--color-atlas-muted-strong)]">
                  Token name
                  <input
                    value={draft.name}
                    onChange={(event) => updateDraft({ name: event.target.value })}
                    className="field mt-1.5"
                    maxLength={TOKEN_NAME_MAX}
                    placeholder="Warehouse stock bridge"
                    aria-invalid={errors.name ? true : undefined}
                  />
                  <span className="mt-1 block text-[11px] font-normal">
                    Up to {TOKEN_NAME_MAX} characters. Names are stored for audit, not the secret.
                  </span>
                </label>
                <label className="block text-[11px] font-semibold text-[var(--color-atlas-muted-strong)]">
                  Expires on (optional)
                  <input
                    type="datetime-local"
                    value={draft.expiresAt}
                    onChange={(event) => updateDraft({ expiresAt: event.target.value })}
                    className="field mt-1.5"
                    aria-invalid={errors.expiresAt ? true : undefined}
                  />
                  <span className="mt-1 block text-[11px] font-normal">
                    Leave empty for a token that never expires.
                  </span>
                </label>
              </div>

              {errors.name ? <p role="alert" className="text-[12px] font-semibold text-[var(--color-danger)]">{errors.name}</p> : null}
              {errors.expiresAt ? <p role="alert" className="text-[12px] font-semibold text-[var(--color-danger)]">{errors.expiresAt}</p> : null}

              <fieldset className="rounded-xl border border-[#eee4db] p-4">
                <legend className="px-1 text-[11px] font-semibold text-[var(--color-atlas-muted-strong)]">
                  Scopes · {draft.scopes.length} selected
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {API_TOKEN_SCOPES.map((scope) => (
                    <label key={scope} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-[13px] text-[var(--color-atlas-ink)] hover:bg-[#fbfcfa]">
                      <input
                        type="checkbox"
                        value={scope}
                        checked={draft.scopes.includes(scope)}
                        onChange={() => toggleScope(scope)}
                        className="size-4 accent-[#f35d3f]"
                      />
                      <span className="font-semibold">{scopeLabel(scope)}</span>
                      <span className="font-data text-[11px] text-[var(--color-atlas-muted-strong)]">{scope}</span>
                    </label>
                  ))}
                </div>
                {errors.scopes ? (
                  <p role="alert" className="mt-3 text-[12px] font-semibold text-[var(--color-danger)]">{errors.scopes}</p>
                ) : draft.scopes.length === 0 ? (
                  <p className="mt-3 text-[12px] text-[var(--color-atlas-muted-strong)]">
                    Select at least one scope — a token with no scopes cannot call anything.
                  </p>
                ) : null}
              </fieldset>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-xl text-[11px] leading-5 text-[var(--color-atlas-muted-strong)]">
                  Minting is recorded in the audit log with your user id. The secret is generated once and only its
                  hash is stored.
                </p>
                <PrimaryButton
                  type="submit"
                  disabled={busy || draft.scopes.length === 0}
                  title={draft.scopes.length === 0 ? "Select at least one scope first" : undefined}
                >
                  {busy ? "Creating…" : "Create token"}
                </PrimaryButton>
              </div>
            </form>
          </Panel>
        ) : null}

        <DataTableFrame>
          <div className="px-5 py-4">
            <SectionHeader
              title="Issued tokens"
              description="The ledger shows the prefix, scopes, and revocation or expiry state. Secrets are never listed, and the server does not expose a creation date per token."
            />
          </div>
          {canManage && rows.length === 0 ? (
            <p className="px-5 pb-8 text-sm text-[var(--color-atlas-muted-strong)]">No API tokens yet.</p>
          ) : null}
          {rows.length > 0 ? (
            <table className="premium-table min-w-[760px] text-left text-[12px]">
              <caption className="sr-only">Public API tokens for this business</caption>
              <thead>
                <tr className="border-b border-[#eee4db] text-[var(--color-atlas-muted-strong)]">
                  <th scope="col" className="px-5 pb-3 font-semibold">Token</th>
                  <th scope="col" className="px-5 pb-3 font-semibold">Scopes</th>
                  <th scope="col" className="px-5 pb-3 font-semibold">State</th>
                  <th scope="col" className="px-5 pb-3 font-semibold">Expiry</th>
                  <th scope="col" className="px-5 pb-3 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const copy = tokenStateCopy(row);
                  return (
                    <tr key={row.id} className="border-b border-[#eee4db]/70">
                      <td className="px-5 py-3">
                        <span className="block font-semibold text-[var(--color-atlas-ink)]">{row.name}</span>
                        <span className="font-data block text-[11px] text-[var(--color-atlas-muted-strong)]">
                          prefix {row.prefix}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-[var(--color-atlas-muted-strong)]">{scopesCopy(row.scopes) || "None"}</td>
                      <td className="px-5 py-3">
                        <StatusPill tone={copy.tone}>{copy.label}</StatusPill>
                        <span className="mt-1 block text-[11px] text-[var(--color-atlas-muted-strong)]">{copy.detail}</span>
                      </td>
                      <td className="font-data px-5 py-3 text-[var(--color-atlas-muted-strong)]">
                        {formatTokenDay(row.expiresAt)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {canManage && copy.state !== "revoked" ? (
                          <DangerButton type="button" onClick={() => { setError(""); setRevoking(row); }}>Revoke</DangerButton>
                        ) : (
                          <span className="text-[11px] text-[var(--color-atlas-muted-strong)]">
                            {copy.state === "revoked" ? "Already revoked" : "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </DataTableFrame>

        <Panel className="p-5">
          <SectionHeader
            title="How these tokens are used"
            description="Send the secret as a bearer credential to the versioned public API. Every call is audited against the token id, and a revoked or expired secret is rejected immediately."
          />
          <pre className="mt-4 overflow-x-auto rounded-xl bg-[#fbfcfa] px-4 py-3 font-data text-[12px] leading-5 text-[var(--color-atlas-ink)]">
            {curlExample}
          </pre>
          <p className="mt-3 text-[12px] leading-5 text-[var(--color-atlas-muted-strong)]">
            Store the secret in your integration&rsquo;s secret manager, never in source control. Rotate by minting a
            new token and revoking the old one; a secret cannot be recovered once it has been shown.
          </p>
        </Panel>
      </main>

      <ConfirmDialog
        open={revoking !== null}
        title={confirmation?.title ?? "Revoke this API token?"}
        description={confirmation?.description ?? ""}
        confirmLabel={confirmation?.confirmLabel ?? "Revoke token"}
        busy={revokeBusy}
        details={confirmation?.details}
        onCancel={() => { if (!revokeBusy) setRevoking(null); }}
        onConfirm={() => void confirmRevoke()}
      />
    </AppShell>
  );
}
