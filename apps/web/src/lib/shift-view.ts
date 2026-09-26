export type ShiftTone = "ok" | "warn" | "bad" | "info";

export function variancePresentation(varianceMinor: number): {
  state: "over" | "short" | "balanced";
  tone: ShiftTone;
  amount: number;
} {
  if (varianceMinor > 0) return { state: "over", tone: "warn", amount: varianceMinor };
  if (varianceMinor < 0) return { state: "short", tone: "bad", amount: varianceMinor };
  return { state: "balanced", tone: "ok", amount: 0 };
}

export function shiftState(status: string): {
  label: string;
  tone: ShiftTone;
  closed: boolean;
} {
  if (status === "CLOSED") return { label: "Closed", tone: "ok", closed: true };
  if (status === "OPEN") return { label: "Open", tone: "info", closed: false };
  return { label: status.replaceAll("_", " "), tone: "warn", closed: false };
}
