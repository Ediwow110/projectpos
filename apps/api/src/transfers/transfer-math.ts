const TRANSFER_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["RECEIVED", "CANCELLED"],
  RECEIVED: [],
  CANCELLED: [],
};

export function canTransitionTransfer(from: string, to: string): string {
  const allowed = TRANSFER_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) throw new Error("TRANSFER_INVALID_STATE");
  return to;
}
