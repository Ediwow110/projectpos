// Pure ESC/POS receipt renderer (Phase 10). No I/O, no floats: money is
// formatted from integer minor units, text is ASCII-folded (thermal
// printers), lines are truncated to the paper width, never wrapped.

export interface EscposLine {
  name: string;
  qty: number;
  priceMinor: number;
  // Amount actually charged for the line (unit price x qty minus any line
  // discount). Printed in place of priceMinor x qty so the receipt reconciles
  // with the sale total; defaults to the gross amount when not supplied.
  lineTotalMinor?: number;
}

export interface EscposInput {
  businessName: string;
  receiptNo: string;
  // Paid receipt customization (PLAN.md 16.2): stored by the business and
  // printed on the thermal receipt.
  header?: string | null;
  footer?: string | null;
  lines: EscposLine[];
  // Printed when non-zero so a discounted or taxed sale reconciles line by
  // line instead of showing a total that does not add up.
  subtotalMinor?: number;
  discountMinor?: number;
  taxMinor?: number;
  totalMinor: number;
  paidMinor: number;
  changeMinor: number;
  layout: "58" | "80";
}

const WIDTHS: Record<EscposInput["layout"], number> = { "58": 32, "80": 48 };

const INIT = [0x1b, 0x40];
const CENTER = [0x1b, 0x61, 0x01];
const LEFT = [0x1b, 0x61, 0x00];
const FEED = [0x0a];
const CUT = [0x1d, 0x56, 0x00];

export function moneyText(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(minor));
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function ascii(s: string): number[] {
  return [...s].map((c) => {
    const code = c.charCodeAt(0);
    return code < 128 ? code : 0x3f;
  });
}

function centered(s: string, width: number): number[] {
  const bytes = ascii(s).slice(0, width);
  const left = Math.max(0, Math.floor((width - bytes.length) / 2));
  return [...Array(left).fill(0x20), ...bytes, 0x0a];
}

function row(left: string, amount: string, width: number): number[] {
  const amountBytes = ascii(amount);
  const nameWidth = Math.max(0, width - amountBytes.length);
  const nameBytes = ascii(left).slice(0, nameWidth);
  const pad = Array(Math.max(0, width - nameBytes.length - amountBytes.length)).fill(0x20);
  return [...nameBytes, ...pad, ...amountBytes, 0x0a];
}

function leftText(text: string, width: number): number[] {
  const bytes = ascii(text).slice(0, width);
  return [...bytes, ...Array(Math.max(0, width - bytes.length)).fill(0x20), 0x0a];
}

// Free-text header/footer lines wrap to the paper width (they are the only
// place text may span more than one line).
function wrapped(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let current = "";
    for (const word of paragraph.split(/\s+/).filter((w) => w !== "")) {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (ascii(candidate).length > width && current !== "") {
        out.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    out.push(current);
  }
  return out.filter((l) => l !== "");
}

export function escposReceipt(input: EscposInput): number[] {
  const width = WIDTHS[input.layout];
  const out: number[] = [...INIT, ...CENTER];
  out.push(...centered(input.businessName, width));
  out.push(...centered(input.receiptNo, width));
  out.push(...FEED, ...LEFT);
  if (input.header !== null && input.header !== undefined && input.header.trim() !== "") {
    for (const line of wrapped(input.header, width)) out.push(...leftText(line, width));
  }
  for (const l of input.lines) {
    const amount = l.lineTotalMinor ?? l.priceMinor * l.qty;
    out.push(...row(`${l.name} x${l.qty}`, moneyText(amount), width));
  }
  if (input.subtotalMinor !== undefined && input.subtotalMinor > 0) {
    out.push(...row("SUBTOTAL", moneyText(input.subtotalMinor), width));
  }
  if (input.discountMinor !== undefined && input.discountMinor > 0) {
    out.push(...row("DISCOUNT", `-${moneyText(input.discountMinor)}`, width));
  }
  if (input.taxMinor !== undefined && input.taxMinor > 0) {
    out.push(...row("TAX", moneyText(input.taxMinor), width));
  }
  out.push(...row("TOTAL", moneyText(input.totalMinor), width));
  out.push(...row("PAID", moneyText(input.paidMinor), width));
  out.push(...row("CHANGE", moneyText(input.changeMinor), width));
  if (input.footer !== null && input.footer !== undefined && input.footer.trim() !== "") {
    for (const line of wrapped(input.footer, width)) out.push(...centered(line, width), 0x0a);
  }
  out.push(...FEED, ...FEED, ...CUT);
  return out;
}
