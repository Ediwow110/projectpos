export interface TeamMemberRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  deactivatedAt: string | null;
  approvalPinSet: boolean;
}

export function teamRoleLabel(role: string): string {
  if (role === "owner") return "Owner";
  if (role === "manager") return "Manager";
  if (role === "cashier") return "Cashier";
  if (role === "inventory") return "Inventory";
  return role;
}

export function canDeactivateMember(currentUserId: string, member: TeamMemberRow): boolean {
  return member.role !== "owner" && member.userId !== currentUserId && member.deactivatedAt === null;
}

export function canManageApprovalPin(member: TeamMemberRow): boolean {
  return member.deactivatedAt === null && (member.role === "owner" || member.role === "manager");
}

export function canChangeMemberRole(currentUserId: string, member: TeamMemberRow): boolean {
  return member.deactivatedAt === null && member.role !== "owner" && member.userId !== currentUserId;
}
