"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "./api";
import { watchConnectivity, type ConnectionState } from "./connectivity";
import type { SyncStore } from "./sync-store";

/** `unprobed` is the state before the first connectivity ping has answered. It is
 * deliberately not `online`: a till that has not finished checking must not tell the
 * cashier the connection is good. */
export type SyncConnectionState = ConnectionState | "unprobed";

/** `unavailable` means the offline store could not be read, so the pending/conflict
 * counts are unknown rather than zero. */
export type SyncSummaryStatus = "ready" | "unavailable";

export interface SyncSummary {
  connection: SyncConnectionState;
  pending: number;
  conflicts: number;
  status: SyncSummaryStatus;
}

export function useSyncSummary(store: SyncStore): SyncSummary {
  const [connection, setConnection] = useState<SyncConnectionState>("unprobed");
  const [status, setStatus] = useState<SyncSummaryStatus>("unavailable");
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  useEffect(() => {
    let alive = true;
    const refresh = async (): Promise<void> => {
      try {
        const all = await store.listAll();
        if (!alive) return;
        setPending(
          all.filter((c) => c.status === "QUEUED" || c.status === "SENDING" || c.status === "FAILED").length,
        );
        setConflicts(all.filter((c) => c.status === "CONFLICT").length);
        setStatus("ready");
      } catch {
        if (!alive) return;
        // Store unavailable — the counts are unknown, not zero.
        setStatus("unavailable");
      }
    };
    const stop = watchConnectivity({
      isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine),
      ping: () => apiFetch<{ ok: boolean }>("/api/v1/health").then(() => true).catch(() => false),
      intervalMs: 15000,
      onChange: (s) => {
        setConnection(s);
        void refresh();
      },
    });
    void refresh();
    return () => {
      alive = false;
      stop();
    };
  }, [store]);
  return { connection, pending, conflicts, status };
}

export function SyncBannerView({ summary }: { summary: SyncSummary }): JSX.Element | null {
  const { connection, pending, conflicts, status } = summary;
  const unprobed = connection === "unprobed";
  const offline = connection === "offline";
  const storeUnreadable = status === "unavailable";
  if (!unprobed && !offline && !storeUnreadable && pending === 0 && conflicts === 0) {
    return null;
  }
  const warning = offline || unprobed || storeUnreadable;
  return (
    <p role="status" className={`flex flex-wrap items-center gap-2 rounded-2xl border px-4 py-2.5 text-[13px] font-semibold ${warning ? "border-[#f0dca6] bg-[#fdf6e3] text-[#8a6414]" : "border-[#bfe6da] bg-[#ecf7f3] text-[#0a5c50]"}`}>
      <span className={`h-2 w-2 rounded-full ${warning ? "bg-amber-500" : "bg-emerald-500"}`} aria-hidden />
      {offline
        ? "Offline — cash only, sales will queue."
        : unprobed
          ? "Connection unverified — still checking this till’s access."
          : "Online."}
      {storeUnreadable ? " Sync status unavailable — queued offline sales could not be read." : ""}
      {pending > 0 ? ` Syncing (${pending} waiting).` : ""}
      {conflicts > 0 ? ` ${conflicts} sync conflict(s) need review. ` : ""}
      {(conflicts > 0 || storeUnreadable) && <Link href="/sync" className="underline">Review sync queue</Link>}
    </p>
  );
}

export function ConnectivityBanner({ store }: { store: SyncStore }): JSX.Element | null {
  return <SyncBannerView summary={useSyncSummary(store)} />;
}

export function SyncAttentionItems({ store }: { store: SyncStore }): JSX.Element {
  const { pending, conflicts, status } = useSyncSummary(store);
  return (
    <>
      {pending > 0 && (
        <li>
          <Link href="/sync">{pending} offline sale(s) waiting to sync</Link>
        </li>
      )}
      {conflicts > 0 && (
        <li>
          <Link href="/sync">{conflicts} sync conflict(s) need review</Link>
        </li>
      )}
      {status === "unavailable" && (
        <li>
          <Link href="/sync">Sync status unavailable — review the sync queue</Link>
        </li>
      )}
    </>
  );
}
