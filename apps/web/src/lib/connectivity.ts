export type ConnectionState = "online" | "offline";

export interface ConnectivityDeps {
  isOnline: () => boolean;
  ping: () => Promise<boolean>;
  intervalMs: number;
  onChange: (state: ConnectionState) => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export function watchConnectivity(deps: ConnectivityDeps): () => void {
  let current: ConnectionState | null = null;
  const check = async (): Promise<void> => {
    const reachable = deps.isOnline() ? await deps.ping().catch(() => false) : false;
    const next: ConnectionState = reachable ? "online" : "offline";
    if (next !== current) {
      current = next;
      deps.onChange(next);
    }
  };
  void check();
  const timer = (deps.setIntervalFn ?? setInterval)(() => void check(), deps.intervalMs);
  return () => (deps.clearIntervalFn ?? clearInterval)(timer);
}
