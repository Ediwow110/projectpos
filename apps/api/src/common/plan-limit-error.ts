export class PlanLimitError extends Error {
  readonly fields: Record<string, string>;

  constructor(fields: Record<string, string | number>) {
    super("PLAN_LIMIT");
    this.name = "PlanLimitError";
    this.fields = Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, String(v)]),
    );
  }
}

export function planLimitFields(e: unknown): Record<string, string[]> | undefined {
  if (!(e instanceof PlanLimitError)) return undefined;
  return Object.fromEntries(
    Object.entries(e.fields).map(([k, v]) => [k, [v]]),
  );
}
