import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { chooseReceiptPrinterId, ReceiptPrinterDialog } from "./ReceiptPrinterDialog";

describe("receipt printer dialog", () => {
  it("selects the default printer when printer data arrives after the dialog opened", () => {
    const printers = [
      { id: "p1", name: "Front Till", branchId: "b1", width: "80", connection: "manual", lastSeenAt: null, agentStatus: "online" as const, isDefault: true },
      { id: "p2", name: "Back Till", branchId: "b1", width: "80", connection: "manual", lastSeenAt: null, agentStatus: "online" as const, isDefault: false },
    ];
    expect(chooseReceiptPrinterId("", printers)).toBe("p1");
    expect(chooseReceiptPrinterId("p2", printers)).toBe("p2");
    expect(chooseReceiptPrinterId("missing", printers)).toBe("p1");
  });

  it("shows default, branch, agent state, and sent-vs-printed semantics", () => {
    const html = renderToStaticMarkup(
      <ReceiptPrinterDialog
        receiptNo="2026-000123"
        receiptBranchId="b1"
        printers={[{
          id: "p1",
          name: "Front Till",
          branchId: "b1",
          width: "80",
          connection: "manual",
          lastSeenAt: "2026-10-01T00:00:00.000Z",
          agentStatus: "online",
          isDefault: true,
        }]}
        branches={[{ id: "b1", name: "Main Branch" }]}
        busy={false}
        error=""
        onQueue={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain("Print receipt");
    expect(html).toContain("Front Till");
    expect(html).toContain("Main Branch");
    expect(html).toContain("Default");
    expect(html).toContain("Online");
    expect(html).toContain("handed to the printer agent");
  });

  it("hides printers assigned to another branch and keeps unassigned printers eligible", () => {
    const html = renderToStaticMarkup(
      <ReceiptPrinterDialog
        receiptNo="2026-000124"
        receiptBranchId="b1"
        printers={[
          { id: "wrong", name: "Other Branch", branchId: "b2", width: "80", connection: "manual", lastSeenAt: null, agentStatus: "never", isDefault: true },
          { id: "shared", name: "Shared Printer", branchId: null, width: "80", connection: "manual", lastSeenAt: null, agentStatus: "never", isDefault: false },
          { id: "right", name: "Branch One", branchId: "b1", width: "80", connection: "manual", lastSeenAt: null, agentStatus: "never", isDefault: false },
        ]}
        branches={[{ id: "b1", name: "Main Branch" }, { id: "b2", name: "Other Branch" }]}
        busy={false}
        error=""
        onQueue={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain("Shared Printer");
    expect(html).toContain("Branch One");
    expect(html).not.toContain("Other Branch");
  });
});
