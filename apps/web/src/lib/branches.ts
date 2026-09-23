const MANAGE_ROLES = new Set(["owner", "manager"]);

export function canManageBranches(role: string): boolean {
  return MANAGE_ROLES.has(role);
}

export function transferStatusLabel(status: string): string {
  if (status === "IN_TRANSIT") return "IN TRANSIT";
  return status;
}

export function buildBranchesQuery(): string {
  return "/api/v1/branches";
}
