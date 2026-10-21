import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(resolve(process.cwd(), "src/app/expenses/page.tsx"), "utf8");

describe("expenses page export consumer", () => {
  it("downloads through the shared export control instead of navigating away", () => {
    expect(pageSource).toContain("expensesDownloadUrl");
    expect(pageSource).toContain("ExportCsvLink");
  });

  it("gates the download on the effective export grant, not a role guess", () => {
    expect(pageSource).toContain("canExport");
    expect(pageSource).not.toMatch(/exportable[^}]*includes\(meQuery\.data\?\.role|includes\(meQuery\.data\.role\)/);
  });
});
