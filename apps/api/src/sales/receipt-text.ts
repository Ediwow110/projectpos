export interface ReceiptTextLine {
  name: string;
  qty: number;
  lineTotalMinor: number;
}

export interface ReceiptTextTender {
  method: string;
  amountMinor: number;
  label?: string;
}

export interface ReceiptTextInput {
  receiptNo: string;
  status: string;
  items: ReceiptTextLine[];
  giftCardLoads: Array<{ amountMinor: number; kind: "NEW" | "RELOAD"; maskedCode: string | null }>;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  deliveryFeeMinor?: number;
  deliveryTaxMinor?: number;
  totalMinor: number;
  paidMinor: number;
  changeMinor: number;
  tenders: ReceiptTextTender[];
}

function money(minor: number): string {
  return (minor / 100).toFixed(2);
}

// FR-RECEIPT-01: the downloadable form of a receipt is a plain-text rendering
// of the same data the digital view and the thermal printer use.
export function renderReceiptText(input: ReceiptTextInput): string {
  const lines: string[] = [];
  lines.push(`Receipt ${input.receiptNo}`);
  lines.push(`Status: ${input.status}`);
  lines.push("");
  for (const item of input.items) {
    lines.push(`${item.name} x ${item.qty} — ${money(item.lineTotalMinor)}`);
  }
  for (const load of input.giftCardLoads) {
    const label = load.kind === "NEW" ? "Gift card load" : "Gift card reload";
    lines.push(`${label} — ${money(load.amountMinor)}${load.maskedCode ? ` (${load.maskedCode})` : ""}`);
  }
  lines.push("");
  lines.push(`SUBTOTAL ${money(input.subtotalMinor)}`);
  if (input.discountMinor !== 0) lines.push(`DISCOUNT -${money(input.discountMinor)}`);
  if (input.taxMinor !== 0) lines.push(`TAX ${money(input.taxMinor)}`);
  if ((input.deliveryFeeMinor ?? 0) !== 0) lines.push(`DELIVERY ${money(input.deliveryFeeMinor ?? 0)}`);
  if ((input.deliveryTaxMinor ?? 0) !== 0) lines.push(`DELIVERY TAX ${money(input.deliveryTaxMinor ?? 0)}`);
  lines.push(`TOTAL ${money(input.totalMinor)}`);
  lines.push(`PAID ${money(input.paidMinor)}`);
  lines.push(`CHANGE ${money(input.changeMinor)}`);
  for (const tender of input.tenders) {
    lines.push(`${tender.label ?? tender.method} ${money(tender.amountMinor)}`);
  }
  return `${lines.join("\n")}\n`;
}
