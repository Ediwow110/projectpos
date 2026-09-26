import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConnectivityBanner } from "./sync-ui";
import { MemorySyncStore } from "./sync-store";

Object.assign(globalThis, { React });

describe("ConnectivityBanner", () => {
  it("stays silent when the till is online with nothing pending", () => {
    const html = renderToStaticMarkup(<ConnectivityBanner store={new MemorySyncStore()} />);

    expect(html).toBe("");
  });
});
