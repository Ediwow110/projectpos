import { describe, expect, it } from "vitest";

import { createAppQueryClient } from "./providers";

describe("app query client", () => {
  it("keeps operational reads fresh while caching shared identity metadata", () => {
    const client = createAppQueryClient();
    const options = client.getDefaultOptions().queries;
    expect(options?.staleTime).toBe(0);
    expect(options?.gcTime).toBe(10 * 60_000);
    expect(options?.refetchOnReconnect).toBe(true);
    expect(client.getQueryDefaults(["me"]).staleTime).toBe(60_000);
  });
});
