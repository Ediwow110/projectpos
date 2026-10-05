export interface FamilyDimensionOption {
  id: string;
  name: string;
}

export function buildFamilyOptionUpdate(
  options: FamilyDimensionOption[],
  names: Record<string, string>,
  additions: Record<string, string>,
  archiveIds: Record<string, string[]>,
): Array<{ id: string; name: string; addValues: string[]; archiveValueIds: string[] }> {
  return options.map((option) => ({
    id: option.id,
    name: names[option.id]?.trim() || option.name,
    addValues: (additions[option.id] ?? "").split(",").map((value) => value.trim()).filter(Boolean),
    archiveValueIds: archiveIds[option.id] ?? [],
  }));
}
