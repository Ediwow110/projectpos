export function formatMoneyMinor(minor: number): string {
  return (minor / 100).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPesoMinor(minor: number): string {
  return `₱${formatMoneyMinor(minor)}`;
}

export function minorToMajorFixed(minor: number): string {
  return (minor / 100).toFixed(2);
}

/** Parses a pesos entry the reviewer typed into whole centavos; null when the ledger cannot hold it. */
export function pesosInputToMinor(input: string): number | null {
  const text = input.trim();
  if (text === "" || !/^-?\d+(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}
