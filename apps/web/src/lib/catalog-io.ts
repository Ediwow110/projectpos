export interface ProductImportItem {
  name: string;
  sku?: string;
  barcode?: string;
  unit?: string;
  priceMinor: number;
  costMinor?: number;
  reorderLevel?: number;
  trackInventory?: boolean;
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      values.push(value.trim());
      value = "";
      continue;
    }
    value += char;
  }
  values.push(value.trim());
  return values;
}

function moneyToMinor(value: string, field: string, row: number): number {
  const amount = Number(value);
  const minor = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(minor)) {
    throw new Error(`Row ${row}: invalid ${field}`);
  }
  return minor;
}

export function parseProductCsv(input: string): ProductImportItem[] {
  const lines = input.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) throw new Error("CSV needs a header and at least one product row.");
  const headers = splitCsvLine(lines[0]!).map((header) => header.trim().toLowerCase());
  const required = ["name", "price"];
  for (const header of required) if (!headers.includes(header)) throw new Error(`Missing required column: ${header}`);
  if (lines.length - 1 > 200) throw new Error("Import is limited to 200 products per batch.");

  const index = (name: string): number => headers.indexOf(name);
  return lines.slice(1).map((line, lineIndex) => {
    const rowNumber = lineIndex + 2;
    const values = splitCsvLine(line);
    const read = (name: string): string => {
      const position = index(name);
      return position < 0 ? "" : (values[position] ?? "").trim();
    };
    const name = read("name");
    if (!name) throw new Error(`Row ${rowNumber}: name is required`);
    const priceMinor = moneyToMinor(read("price"), "price", rowNumber);
    const costText = read("cost");
    const reorderText = read("reorder_level");
    const trackText = read("track_inventory").toLowerCase();
    const reorderLevel = reorderText === "" ? 0 : Number(reorderText);
    if (!Number.isInteger(reorderLevel) || reorderLevel < 0) throw new Error(`Row ${rowNumber}: invalid reorder_level`);
    if (trackText && !["true", "false", "1", "0", "yes", "no"].includes(trackText)) throw new Error(`Row ${rowNumber}: invalid track_inventory`);
    const truthy = ["true", "1", "yes"].includes(trackText);
    return {
      name,
      ...(read("sku") ? { sku: read("sku") } : {}),
      ...(read("barcode") ? { barcode: read("barcode") } : {}),
      ...(read("unit") ? { unit: read("unit") } : {}),
      priceMinor,
      ...(costText ? { costMinor: moneyToMinor(costText, "cost", rowNumber) } : {}),
      reorderLevel,
      trackInventory: trackText === "" ? true : truthy,
    };
  });
}

function escapeCsv(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

export function productRowsToCsv(rows: Array<{ name: string; sku: string | null; priceMinor: number; isActive: boolean }>): string {
  const out = ["name,sku,price,status"];
  for (const row of rows) {
    out.push([
      escapeCsv(row.name),
      escapeCsv(row.sku ?? ""),
      (row.priceMinor / 100).toFixed(2),
      row.isActive ? "active" : "archived",
    ].join(","));
  }
  return out.join("\n") + "\n";
}
