import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { syncStatusPresentation } from "./system-view";

describe("system status presentation", () => {
  it("keeps queued and retrying work non-final", () => {
    expect(syncStatusPresentation("QUEUED")).toEqual({ label: "Queued", tone: "info", final: false });
    expect(syncStatusPresentation("SENDING")).toEqual({ label: "Syncing", tone: "warn", final: false });
    expect(syncStatusPresentation("FAILED")).toEqual({ label: "Retry needed", tone: "warn", final: false });
  });

  it("distinguishes conflict from successful completion", () => {
    expect(syncStatusPresentation("CONFLICT")).toEqual({ label: "Conflict", tone: "bad", final: false });
    expect(syncStatusPresentation("SYNCED")).toEqual({ label: "Synced", tone: "ok", final: true });
    expect(syncStatusPresentation("RESOLVED")).toEqual({ label: "Resolved", tone: "ok", final: true });
  });

  it("uses the real transfers endpoint on the premium Branches surface", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/branches/page.tsx"), "utf8");
    expect(source).toContain("/api/v1/transfers");
    expect(source).toContain("Inventory transfers");
  });
});
