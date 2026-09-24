import { describe, expect, it } from "vitest";
import { escposReceipt } from "./escpos";

const sp = (n: number): number[] => Array(n).fill(0x20);
const text = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

describe("phase10 escpos bytes", () => {
  it("renders an exact 58mm receipt", () => {
    const bytes = escposReceipt({
      businessName: "AB",
      receiptNo: "0001",
      lines: [{ name: "C", qty: 1, priceMinor: 250 }],
      totalMinor: 250,
      paidMinor: 250,
      changeMinor: 0,
      layout: "58",
    });
    expect(bytes).toEqual([
      0x1b, 0x40,
      0x1b, 0x61, 0x01,
      ...sp(15), ...text("AB"), 0x0a,
      ...sp(14), ...text("0001"), 0x0a,
      0x0a,
      0x1b, 0x61, 0x00,
      ...text("C x1"), ...sp(24), ...text("2.50"), 0x0a,
      ...text("TOTAL"), ...sp(23), ...text("2.50"), 0x0a,
      ...text("PAID"), ...sp(24), ...text("2.50"), 0x0a,
      ...text("CHANGE"), ...sp(22), ...text("0.00"), 0x0a,
      0x0a, 0x0a,
      0x1d, 0x56, 0x00,
    ]);
  });
  it("renders an exact 80mm receipt", () => {
    const bytes = escposReceipt({
      businessName: "AB",
      receiptNo: "0001",
      lines: [{ name: "C", qty: 1, priceMinor: 250 }],
      totalMinor: 250,
      paidMinor: 250,
      changeMinor: 0,
      layout: "80",
    });
    expect(bytes).toEqual([
      0x1b, 0x40,
      0x1b, 0x61, 0x01,
      ...sp(23), ...text("AB"), 0x0a,
      ...sp(22), ...text("0001"), 0x0a,
      0x0a,
      0x1b, 0x61, 0x00,
      ...text("C x1"), ...sp(40), ...text("2.50"), 0x0a,
      ...text("TOTAL"), ...sp(39), ...text("2.50"), 0x0a,
      ...text("PAID"), ...sp(40), ...text("2.50"), 0x0a,
      ...text("CHANGE"), ...sp(38), ...text("0.00"), 0x0a,
      0x0a, 0x0a,
      0x1d, 0x56, 0x00,
    ]);
  });
  it("replaces non-ascii text and truncates overlong lines", () => {
    const bytes = escposReceipt({
      businessName: "Café ★",
      receiptNo: "0002",
      lines: [{ name: "X".repeat(100), qty: 1, priceMinor: 100 }],
      totalMinor: 100,
      paidMinor: 100,
      changeMinor: 0,
      layout: "58",
    });
    expect(bytes.slice(0, 2)).toEqual([0x1b, 0x40]);
    expect(bytes.slice(-3)).toEqual([0x1d, 0x56, 0x00]);
    expect(bytes.every((b) => b < 128)).toBe(true);
    // No text line exceeds 32 columns: strip ESC command sequences
    // (1B + 2 bytes, 1D + 2 bytes), then split on feeds.
    const text: number[] = [];
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]!;
      if (b === 0x1b || b === 0x1d) { i += 2; continue; }
      text.push(b);
    }
    const lines: number[][] = [];
    let cur: number[] = [];
    for (const b of text) {
      if (b === 0x0a) { lines.push(cur); cur = []; } else cur.push(b);
    }
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(32);
    }
  });
});
