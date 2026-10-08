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
