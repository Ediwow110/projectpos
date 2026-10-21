import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { ExportController, LEDGER_EXPORT_ROW_WINDOW } from "./export.controller";

// 200 pages of 500 rows: far past any sane per-request window, with a natural
// end so the unfixed controller cannot run this test forever.
const PAGES_PAST_WINDOW = 200;
const PAGE_SIZE = 500;

function request(businessId: string): Request {
  return {
    auth: { businessId, userId: "owner-1", role: "owner" },
    headers: {},
  } as unknown as Request;
}

interface Recorder {
  res: Response;
  chunks: string[];
  codes: string[];
}

function recorder(): Recorder {
  const chunks: string[] = [];
  const codes: string[] = [];
  const self = {
    status: vi.fn(), set: vi.fn(), end: vi.fn(), headersSent: false,
    write: (chunk: unknown) => { chunks.push(String(chunk)); return true; },
    json: (body: { code?: string }) => { if (body && body.code) codes.push(body.code); return self; },
  };
  self.status.mockImplementation(() => self);
  self.set.mockImplementation(() => self);
  return { res: self as unknown as Response, chunks, codes };
}

function row(index: number) {
  return { date: "2026-10-21", type: "sale", ref: `R${index}`, account: "4000", debitMinor: 100, creditMinor: 0, memo: "export row" };
}

function pagesBeyondTheWindow() {
  return {
    streamJournalRows: () => ({
      [Symbol.asyncIterator]: () => {
        let page = 0;
        return {
          next: async () => {
            // One page per call: the counter advances by a page, so the stream
            // really runs past the window instead of ending after one page.
            if (page >= PAGES_PAST_WINDOW) return { done: true as const, value: undefined };
            const start = page * PAGE_SIZE;
            page += 1;
            return { done: false as const, value: Array.from({ length: PAGE_SIZE }, (_, i) => row(start + i)) };
          },
          return: async () => ({ done: true as const, value: undefined }),
        };
      },
    }),
  };
}

describe("ledger export bounds", () => {
  it("stops a single export at the row window instead of streaming the whole journal", async () => {
    const controller = new ExportController(pagesBeyondTheWindow() as never, { permissionsForRequest: () => ["export.run"] } as never);
    const { res, chunks } = recorder();

    await controller.ledger(request("business-window-1"), res, { format: "csv" });

    // header line + the window's worth of rows + one truncation notice
    expect(chunks).toHaveLength(LEDGER_EXPORT_ROW_WINDOW + 2);
    expect(chunks.at(-1)).toContain(String(LEDGER_EXPORT_ROW_WINDOW));
    expect(chunks.at(-1)).toContain("date range");
    expect(res.end).toHaveBeenCalled();
  });

  it("refuses the requests past the limiter before any byte of the stream goes out", async () => {
    const streamJournalRows = vi.fn(() => ({
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true as const, value: undefined }) }),
    }));
    const controller = new ExportController({ streamJournalRows } as never, { permissionsForRequest: () => ["export.run"] } as never);
    const responses: Recorder[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const entry = recorder();
      await controller.ledger(request("business-limiter-1"), entry.res, { format: "csv" });
      responses.push(entry);
    }
    const refused = responses.filter((entry) => entry.codes.includes("RATE_LIMITED"));
    const streamed = responses.filter((entry) => !entry.codes.includes("RATE_LIMITED"));
    expect(streamed.length).toBeGreaterThan(0);
    expect(refused.length).toBeGreaterThan(0);
    for (const entry of refused) {
      expect(entry.res.status).toHaveBeenCalledWith(429);
      // A refusal arrives as a JSON error, never as a 200 stream.
      expect(entry.chunks).toHaveLength(0);
    }
    expect(streamJournalRows).toHaveBeenCalledTimes(streamed.length);
  });
});
