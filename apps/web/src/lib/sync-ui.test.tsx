import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConnectivityBanner, SyncAttentionItems, SyncBannerView, type SyncSummary } from "./sync-ui";
import type { SyncStore } from "./sync-store";
import { MemorySyncStore } from "./sync-store";

Object.assign(globalThis, { React });

const summary = (overrides: Partial<SyncSummary> = {}): SyncSummary => ({
  connection: "online",
  pending: 0,
  conflicts: 0,
  status: "ready",
  ...overrides,
});

/** A store whose IndexedDB backend is unreadable, exactly as it is on a till whose
 *  offline database was cleared, corrupted, or is blocked by the browser. */
function unreadableStore(): SyncStore {
  const store = new MemorySyncStore();
  store.listAll = async () => {
    throw new Error("INDEXEDDB_UNAVAILABLE");
  };
  return store;
}

describe("ConnectivityBanner", () => {
  it("warns rather than going silent before the first connectivity probe completes", () => {
    const html = renderToStaticMarkup(<ConnectivityBanner store={new MemorySyncStore()} />);

    expect(html).toContain("unverified");
  });

  it("warns instead of hiding the banner when the offline store cannot be read", () => {
    const html = renderToStaticMarkup(<ConnectivityBanner store={unreadableStore()} />);

    expect(html).toContain("Sync status unavailable");
    expect(html).toContain("Review sync queue");
  });

  it("keeps warning when the ping succeeded but the offline store is still unreadable", () => {
    // The banner must not collapse to "online, nothing pending" when the counts are unknown:
    // that is exactly the case where stranded offline sales disappear from the till.
    const html = renderToStaticMarkup(<SyncBannerView summary={summary({ status: "unavailable" })} />);

    expect(html).toContain("Sync status unavailable");
    expect(html).not.toContain(">Online.<");
  });

  it("stays silent once a probe reports the till online and the store readable with nothing pending", () => {
    const html = renderToStaticMarkup(<SyncBannerView summary={summary()} />);

    expect(html).toBe("");
  });

  it("still offers the sync queue when the unreadable store reports zero counts", () => {
    const html = renderToStaticMarkup(<SyncAttentionItems store={unreadableStore()} />);

    expect(html).toContain("review the sync queue");
  });
});
