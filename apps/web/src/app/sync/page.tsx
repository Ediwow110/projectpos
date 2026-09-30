"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
import { ApiError, apiFetch } from "../../lib/api";
import { backoffDelayMs } from "../../lib/sync-state";
import {
  IndexedDbSyncStore,
  clearActiveSyncScope,
  createActiveSyncStore,
  persistActiveSyncScope,
  type OutboxCommand,
} from "../../lib/sync-store";
import { runReplayOnce } from "../../lib/replay";
import { sendSaleCommand } from "../../lib/replay-sale";
import { ConnectivityBanner } from "../../lib/sync-ui";
import { syncStatusPresentation } from "../../lib/system-view";

interface Csrf {
  csrfToken: string;
}

interface Me {
  userId: string;
  businessId: string;
  role: string;
  businessName?: string;
}

const STATUSES = ["QUEUED", "SENDING", "SYNCED", "CONFLICT", "FAILED", "RESOLVED"];

export default function SyncPage(): JSX.Element {
  const [store, setStore] = useState<IndexedDbSyncStore | null>(() => createActiveSyncStore());
  const [status, setStatus] = useState("");
  const [resolveReason, setResolveReason] = useState<Record<string, string>>({});
  const [syncing, setSyncing] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<Me>("/api/v1/me"),
    retry: false,
  });
  useEffect(() => {
    if (meQuery.data) {
      const scope = { userId: meQuery.data.userId, businessId: meQuery.data.businessId };
      persistActiveSyncScope(scope);
      setStore((current) => current?.scope.userId === scope.userId && current.scope.businessId === scope.businessId
        ? current
        : new IndexedDbSyncStore(scope));
      return;
    }
    if (meQuery.error instanceof ApiError && (meQuery.error.status === 401 || meQuery.error.status === 403)) {
      clearActiveSyncScope();
      setStore(null);
    }
  }, [meQuery.data, meQuery.error]);
  const listQuery = useQuery({
    queryKey: ["sync-outbox", store?.databaseName ?? "none"],
    queryFn: () => store!.listAll(),
    retry: false,
    enabled: store !== null && !meQuery.isLoading && !(meQuery.error instanceof ApiError && (meQuery.error.status === 401 || meQuery.error.status === 403)),
  });
  async function sendReal(cmd: OutboxCommand): Promise<{ status: number; code: string | null; resultId: string | null }> {
    if (cmd.commandType !== "sale.complete") {
      return { status: 400, code: "VALIDATION", resultId: null };
    }
    const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
    return sendSaleCommand(cmd, {
      check: async (key) => {
        const result = await apiFetch<{ applied: Array<{ key: string; resultId: string }>; unknown: Array<{ key: string }> }>(
          "/api/v1/sync/check",
          {
            csrfToken: csrf.csrfToken,
            init: {
              method: "POST",
              body: JSON.stringify({ keys: [{ key, commandType: cmd.commandType }] }),
              headers: { "Idempotency-Key": crypto.randomUUID() },
            },
          },
        );
        const hit = result.applied.find((entry) => entry.key === key);
        return hit ? { applied: true, resultId: hit.resultId } : { applied: false };
      },
      createDraft: async (body) =>
        apiFetch<{ id: string; totalMinor: number }>("/api/v1/sales/drafts", {
          csrfToken: csrf.csrfToken,
          init: { method: "POST", body: JSON.stringify(body) },
        }),
      complete: async (key, body) => {
        try {
          const done = await apiFetch<{ id: string }>("/api/v1/sales/complete", {
            csrfToken: csrf.csrfToken,
            init: {
              method: "POST",
              body: JSON.stringify(body),
              headers: { "Idempotency-Key": key },
            },
          });
          return { status: 201, code: null, resultId: done.id };
        } catch (err) {
          if (err instanceof ApiError) return { status: err.status, code: err.code, resultId: null };
          throw err;
        }
      },
    });
  }

  async function syncNow(): Promise<void> {
    if (syncing) return;
    setStatus("");
    if (!store) {
      setStatus("Sync is unavailable until this signed-in workspace is identified.");
      return;
    }
    setSyncing(true);
    try {
      const summary = await runReplayOnce({
        store,
        send: sendReal,
        nowMs: () => Date.now(),
        dueCheck: (cmd, now) => {
          if (cmd.lastAttemptAt === null) return true;
          const delay = backoffDelayMs(cmd.attempts);
          if (delay === null) return false;
          return now - Date.parse(cmd.lastAttemptAt) >= delay;
        },
      });
      await listQuery.refetch();
      setStatus("Sync pass: " + summary.synced + " synced, " + summary.conflicts + " conflicts, " + summary.retried + " retryable.");
    } catch {
      setStatus("Sync pass failed to run.");
    } finally {
      setSyncing(false);
    }
  }

  async function retry(cmd: OutboxCommand): Promise<void> {
    if (!store) return;
    await store.mark({ localId: cmd.localId, status: "QUEUED", lastError: null });
    await listQuery.refetch();
    await syncNow();
  }

  async function resolve(cmd: OutboxCommand): Promise<void> {
    if (!store || resolvingId !== null) return;
    const reason = (resolveReason[cmd.localId] ?? "").trim();
    if (reason.length < 3) {
      setStatus("A reason of at least 3 characters is required to resolve.");
      return;
    }
    setStatus("");
    setResolvingId(cmd.localId);
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/sync/resolve", {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          body: JSON.stringify({ key: cmd.key, commandType: cmd.commandType, reason }),
          headers: { "Idempotency-Key": crypto.randomUUID() },
        },
      });
      await store.mark({ localId: cmd.localId, status: "RESOLVED", lastError: null });
      await listQuery.refetch();
      setStatus("Conflict resolved and recorded.");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.code + ": " + err.message : "Resolve failed");
    } finally {
      setResolvingId(null);
    }
  }

  const items = (listQuery.data ?? []).filter((command) => STATUSES.includes(command.status));
  const queued = items.filter((command) => command.status === "QUEUED" || command.status === "SENDING").length;
  const conflicts = items.filter((command) => command.status === "CONFLICT").length;
  const failed = items.filter((command) => command.status === "FAILED").length;
  const synced = items.filter((command) => command.status === "SYNCED" || command.status === "RESOLVED").length;

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="System / Sync"
          title="Sync"
          description="Know what is queued, retrying, conflicted, or safely synchronized before it becomes a store problem."
          actions={
            <PrimaryButton type="button" onClick={() => void syncNow()} disabled={syncing} aria-busy={syncing}>
              {syncing ? "Syncing…" : "↻ Sync now"}
            </PrimaryButton>
          }
        />

        {store ? <ConnectivityBanner store={store} /> : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Sync summary">
          <MetricCard label="Queued / sending" value={queued} icon="↻" tone={queued > 0 ? "info" : "success"} meta="Not final yet" />
          <MetricCard label="Conflicts" value={conflicts} icon="!" tone={conflicts > 0 ? "warning" : "success"} meta="Require human review" />
          <MetricCard label="Retry needed" value={failed} icon="↺" tone={failed > 0 ? "warning" : "success"} meta="Safe replay candidates" />
          <MetricCard label="Synced / resolved" value={synced} icon="✓" tone="success" meta="Final queue states" />
        </section>

        <DataTableFrame>
          <div className="px-5 py-4">
            <h2 className="font-display text-base font-semibold">Sync queue</h2>
            <p className="mt-1 text-[11px] text-[#7a6f66]">Provisional receipts remain visibly provisional until the server confirms or a conflict is resolved.</p>
          </div>
          {listQuery.isLoading ? <p className="px-5 pb-6 text-sm text-[#73685f]">Loading queue…</p> : null}
          {items.length === 0 && !listQuery.isLoading ? <p className="px-5 pb-8 text-sm text-[#8b8077]">No offline commands queued.</p> : null}
          {items.length > 0 ? (
            <div className="space-y-2 border-t border-[#eee6de] p-4">
              {items.map((command) => {
                const presentation = syncStatusPresentation(command.status);
                return (
                  <article key={command.localId} className="rounded-xl bg-[#fcf8f3] p-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-data text-[10px] font-medium text-[#2a241f]">{command.provisionalReceipt ?? command.localId.slice(0, 8)}</p>
                        <p className="mt-1 text-[10px] text-[#73685f]">{command.commandType} · attempts {command.attempts}</p>
                        {command.lastError ? <p className="mt-1 text-[10px] text-[#c43e3e]">{command.lastError}</p> : null}
                        {command.serverResultId ? <p className="font-data mt-1 text-[9px] text-[#1f8a5b]">server record {command.serverResultId.slice(0, 8)}</p> : null}
                      </div>
                      <StatusPill tone={presentation.tone}>{presentation.label}{presentation.final ? "" : " · pending"}</StatusPill>
                      {(command.status === "FAILED" || command.status === "CONFLICT") ? (
                        <GhostButton type="button" className="!min-h-8 !px-3 !py-1.5 text-xs" onClick={() => void retry(command)} disabled={syncing || resolvingId !== null}>Retry</GhostButton>
                      ) : null}
                    </div>
                    {command.status === "CONFLICT" ? (
                      <form
                        noValidate
                        onSubmit={(event) => {
                          event.preventDefault();
                          void resolve(command);
                        }}
                        className="mt-3 grid gap-2 border-t border-[#eee6de] pt-3 sm:grid-cols-[1fr_auto]"
                      >
                        <label className="text-[10px] font-semibold text-[#655b53]">
                          Resolution reason
                          <input
                            value={resolveReason[command.localId] ?? ""}
                            onChange={(event) => setResolveReason({ ...resolveReason, [command.localId]: event.target.value })}
                            placeholder="How was this resolved?"
                            className="field mt-1.5"
                          />
                        </label>
                        <PrimaryButton
                          type="submit"
                          className="self-end"
                          disabled={resolvingId !== null}
                          aria-busy={resolvingId === command.localId}
                        >
                          {resolvingId === command.localId ? "Resolving…" : "Resolve conflict"}
                        </PrimaryButton>
                      </form>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : null}
        </DataTableFrame>

        <Panel className="p-5">
          <SectionHeader
            title="Device management moved"
            description="Sync is reserved for offline replay and conflict recovery. Register, review, and revoke tills or workstations from Device Fleet."
            action={
              <Link
                href="/devices"
                className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 py-2.5 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f] hover:text-[#d94a30]"
              >
                Open Device Fleet
              </Link>
            }
          />
        </Panel>

        {status !== "" ? <p role="status" className="rounded-xl border border-[#eee4db] bg-white px-4 py-3 text-sm font-medium text-[#2a241f] shadow-[0_4px_14px_-6px_rgb(28_20_15/0.08)]">{status}</p> : null}
        <Link href="/" className="text-[11px] font-semibold text-[#e44e34]">← Back to dashboard</Link>
      </main>
    </AppShell>
  );
}
