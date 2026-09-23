export function toCsv(headers: string[], rows: Array<Array<string | number | null>>): string {
  const cell = (v: string | number | null): string => {
    const s = v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return ["\uFEFF" + headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n");
}
