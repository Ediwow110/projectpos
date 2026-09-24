"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../lib/api";
import { backoffDelayMs } from "../../lib/sync-state";
import { IndexedDbSyncStore, type OutboxCommand } from "../../lib/sync-store";
import { runReplayOnce } from "../../lib/replay";
import { sendSaleCommand } from "../../lib/replay-sale";
import { ConnectivityBanner } from "../../lib/sync-ui";

interface Csrf {
  csrfToken: string;
}

const STATUSES = ["QUEUED", "SENDING", "SYNCED", "CONFLICT", "FAILED", "RESOLVED"];

export default function SyncPage(): JSX.Element {
  const [store] = useState(() => new IndexedDbSyncStore());
  const [status, setStatus] = useState("");
  const [resolveReason, setResolveReason] = useState<Record<string, string>>({});
  const [deviceLabel, setDeviceLabel] = useState("");

  const listQuery = useQuery({
    queryKey: ["sync-outbox"],
    queryFn: () => store.listAll(),
    retry: false,
  });

  async function sendReal(cmd: OutboxCommand): Promise<{ status: number; code: string | null; resultId: string | null }> {
    if (cmd.commandType !== "sale.complete") {
      return { status: 400, code: "VALIDATION", resultId: null };
    }
    const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
    return sendSaleCommand(cmd, {
      check: async (key) => {
        const r = await apiFetch<{ applied: Array<{ key: string; resultId: string }>; unknown: Array<{ key: string }> }>(
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
        const hit = r.applied.find((a) => a.key === key);
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
    setStatus("");
    try {
      const summary = await runReplayOnce({
        store,
        send: sendReal,
        nowMs: () => Date.now(),
        dueCheck: (cmd, now) => {
          if (cmd.lastAttemptAt === null) return true;
          const d = backoffDelayMs(cmd.attempts);
          if (d === null) return false;
          return now - Date.parse(cmd.lastAttemptAt) >= d;
        },
      });
      await listQuery.refetch();
      setStatus(`Sync pass: ${summary.synced} synced, ${summary.conflicts} conflicts, ${summary.retried} retryable.`);
    } catch {
      setStatus("Sync pass failed to run.");
    }
  }

  async function retry(cmd: OutboxCommand): Promise<void> {
    await store.mark({ localId: cmd.localId, status: "QUEUED", lastError: null });
    await listQuery.refetch();
    await syncNow();
  }

  async function resolve(cmd: OutboxCommand): Promise<void> {
    const reason = (resolveReason[cmd.localId] ?? "").trim();
    if (reason.length < 3) {
      setStatus("A reason of at least 3 characters is required to resolve.");
      return;
    }
    setStatus("");
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
    }
  }

  async function enrollDevice(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setStatus("");
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      const dev = await apiFetch<{ id: string }>("/api/v1/devices", {
        csrfToken: csrf.csrfToken,
        init: { method: "POST", body: JSON.stringify({ label: deviceLabel.trim() }) },
      });
      window.localStorage.setItem("pos-device-id", dev.id);
      setDeviceLabel("");
      setStatus("This device is registered. Future sign-ins will bind to it.");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.code + ": " + err.message : "Enrollment failed");
    }
  }

  const items = (listQuery.data ?? []).filter((c) => STATUSES.includes(c.status));

  return (
    <main>
      <Link href="/">Back to dashboard</Link>
      <h1>Sync queue</h1>
      <ConnectivityBanner store={store} />
      <button onClick={() => void syncNow()}>Sync now</button>
      {listQuery.isLoading && <p>Loading queue…</p>}
      {items.length === 0 && <p>No offline commands queued.</p>}
      <ul>
        {items.map((c) => (
          <li key={c.localId} style={{ fontVariantNumeric: "tabular-nums" }}>
            {c.provisionalReceipt ?? c.localId.slice(0, 8)} — {c.status} — attempts {c.attempts}
            {c.lastError ? ` — ${c.lastError}` : ""}
            {c.serverResultId ? ` — server record ${c.serverResultId.slice(0, 8)}` : ""}{" "}
            {(c.status === "FAILED" || c.status === "CONFLICT") && (
              <button onClick={() => void retry(c)}>Retry</button>
            )}{" "}
            {c.status === "CONFLICT" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void resolve(c);
                }}
              >
                <label>
                  Resolution reason
                  <input
                    value={resolveReason[c.localId] ?? ""}
                    onChange={(e) => setResolveReason({ ...resolveReason, [c.localId]: e.target.value })}
                    placeholder="How was this resolved?"
                  />
                </label>
                <button type="submit">Resolve</button>
              </form>
            )}
          </li>
        ))}
      </ul>
      <section aria-label="Device">
        <h2>This device</h2>
        <form onSubmit={(e) => void enrollDevice(e)}>
          <label>
            Device label
            <input value={deviceLabel} onChange={(e) => setDeviceLabel(e.target.value)} placeholder="Till 1" />
          </label>
          <button type="submit">Register this device</button>
        </form>
      </section>
      {status !== "" && <p role="status">{status}</p>}
    </main>
  );
}
