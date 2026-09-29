import { describe, expect, it } from "vitest";

import { deviceStatusLabel, isCurrentDevice, shortDeviceId } from "./device-view";

describe("device fleet presentation", () => {
  it("labels active and revoked devices explicitly", () => {
    expect(deviceStatusLabel(null)).toBe("Active");
    expect(deviceStatusLabel("2026-09-30T00:00:00.000Z")).toBe("Revoked");
  });

  it("marks only the exact locally-bound device as current", () => {
    expect(isCurrentDevice("dev_123", "dev_123")).toBe(true);
    expect(isCurrentDevice("dev_123", "dev_456")).toBe(false);
    expect(isCurrentDevice("dev_123", null)).toBe(false);
  });

  it("abbreviates long ids without inventing status metadata", () => {
    expect(shortDeviceId("dev_1234567890abcdef")).toBe("dev_123456…");
    expect(shortDeviceId("short")).toBe("short");
  });
});
