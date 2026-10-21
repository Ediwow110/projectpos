import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(resolve(process.cwd(), "src/app/registers/page.tsx"), "utf8");

describe("registers page display pairing", () => {
  it("offers the display token endpoint a way to be called", () => {
    expect(pageSource).toContain("display/tokens");
    expect(pageSource).toContain("DisplayLinkCard");
    expect(pageSource).toContain("displayLink");
  });

  it("shows pairing for sellers only, the same set the endpoint accepts", () => {
    expect(pageSource).toContain("canPairCustomerDisplay");
  });

  it("clears the pairing token from state when the dialog closes", () => {
    expect(pageSource).toMatch(/setTicket\(null\)/);
  });
});
