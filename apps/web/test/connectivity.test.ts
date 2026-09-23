import { describe, expect, it } from "vitest";

describe("phase9b connectivity monitor", () => {
  it("emits online then offline on transitions only", async () => {
    const { watchConnectivity } = await import("../src/lib/connectivity");
    let online = true;
    let pingOk = true;
    const seen: string[] = [];
    const timers: Array<() => void> = [];
    const stop = watchConnectivity({
      isOnline: () => online,
      ping: async () => pingOk,
      intervalMs: 15000,
      onChange: (s) => { seen.push(s); },
      setIntervalFn: ((fn: () => void) => { timers.push(fn); return 1; }) as typeof setInterval,
      clearIntervalFn: (() => undefined) as typeof clearInterval,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual(["online"]);
    pingOk = false;
    timers.forEach((fn) => fn());
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual(["online", "offline"]);
    timers.forEach((fn) => fn());
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual(["online", "offline"]);
    online = true;
    pingOk = true;
    timers.forEach((fn) => fn());
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual(["online", "offline", "online"]);
    stop();
  });
  it("treats browser offline as offline without pinging", async () => {
    const { watchConnectivity } = await import("../src/lib/connectivity");
    let pings = 0;
    const seen: string[] = [];
    watchConnectivity({
      isOnline: () => false,
      ping: async () => { pings += 1; return true; },
      intervalMs: 15000,
      onChange: (s) => { seen.push(s); },
      setIntervalFn: ((() => 1) as unknown) as typeof setInterval,
      clearIntervalFn: (() => undefined) as typeof clearInterval,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual(["offline"]);
    expect(pings).toBe(0);
  });
});
