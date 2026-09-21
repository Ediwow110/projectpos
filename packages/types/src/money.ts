export type MoneyMinor = number & { readonly __brand: "MoneyMinor" };

export function assertInteger(n: number): void {
  if (!Number.isInteger(n)) throw new Error("MONEY_NOT_INTEGER");
}

export function toMoneyMinor(n: number): MoneyMinor {
  assertInteger(n);
  return n as MoneyMinor;
}

export function addMoney(a: number, b: number): MoneyMinor {
  assertInteger(a);
  assertInteger(b);
  return ((a as number) + (b as number)) as MoneyMinor;
}

export function subtractMoney(a: number, b: number): MoneyMinor {
  assertInteger(a);
  assertInteger(b);
  return ((a as number) - (b as number)) as MoneyMinor;
}
