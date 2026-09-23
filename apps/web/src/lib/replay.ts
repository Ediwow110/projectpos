import { classifyReplay, nextSyncState } from "./sync-state";
import type { OutboxCommand, SyncStore } from "./sync-store";

export interface ReplayDeps {
  store: SyncStore;
  send: (cmd: OutboxCommand) => Promise<{ status: number; code: string | null; resultId: string | null }>;
  nowMs: () => number;
  dueCheck: (cmd: OutboxCommand, nowMs: number) => boolean;
}

export interface ReplaySummary {
  sent: number;
  synced: number;
  conflicts: number;
  retried: number;
}

export async function runReplayOnce(deps: ReplayDeps): Promise<ReplaySummary> {
  const pending = await deps.store.listPending();
  const now = deps.nowMs();
  let sent = 0;
  let synced = 0;
  let conflicts = 0;
  let retried = 0;
  for (const cmd of pending) {
    if (cmd.status === "FAILED" && !deps.dueCheck(cmd, now)) continue; // backoff not elapsed
    await deps.store.mark({ localId: cmd.localId, status: "SENDING", lastAttemptAt: new Date(now).toISOString() });
    sent += 1;
    let outcome: ReturnType<typeof classifyReplay>;
    let resultId: string | null = null;
    try {
      const res = await deps.send(cmd);
      outcome = classifyReplay(res.status, res.code);
      resultId = res.resultId;
    } catch {
      outcome = { kind: "replayable", code: "NETWORK" };
    }
    const next = nextSyncState(outcome);
    if (next === "SYNCED") {
      await deps.store.mark({ localId: cmd.localId, status: "SYNCED", serverResultId: resultId, lastError: null });
      synced += 1;
    } else if (next === "CONFLICT") {
      await deps.store.mark({
        localId: cmd.localId,
        status: "CONFLICT",
        attempts: cmd.attempts + 1,
        lastError: outcome.kind === "conflict" ? outcome.code : "UNKNOWN",
      });
      conflicts += 1;
    } else {
      await deps.store.mark({
        localId: cmd.localId,
        status: "FAILED",
        attempts: cmd.attempts + 1,
        lastError: outcome.kind === "replayable" ? outcome.code : "UNKNOWN",
      });
      retried += 1;
    }
  }
  return { sent, synced, conflicts, retried };
}
