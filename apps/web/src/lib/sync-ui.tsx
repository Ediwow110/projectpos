"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "./api";
import { watchConnectivity, type ConnectionState } from "./connectivity";
import type { SyncStore } from "./sync-store";

export function useSyncSummary(store: SyncStore): {
  connection: ConnectionState;
  pending: number;
  conflicts: number;
} {
  const [connection, setConnection] = useState<ConnectionState>("online");
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
      } catch {
        // Store unavailable — stay at zero rather than break the page.
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
  return { connection, pending, conflicts };
}

export function ConnectivityBanner({ store }: { store: SyncStore }): JSX.Element {
  const { connection, pending, conflicts } = useSyncSummary(store);
  if (connection === "online" && pending === 0 && conflicts === 0) {
    return <p>Online.</p>;
  }
  return (
    <p role="status">
      {connection === "offline" ? "Offline." : "Online."}
      {pending > 0 ? ` Syncing (${pending} waiting).` : ""}
      {conflicts > 0 ? ` ${conflicts} sync conflict(s) need review. ` : ""}
      {conflicts > 0 && <Link href="/sync">Review sync queue</Link>}
    </p>
  );
}

export function SyncAttentionItems({ store }: { store: SyncStore }): JSX.Element {
  const { pending, conflicts } = useSyncSummary(store);
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
    </>
  );
}
