export interface TeamMemberRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  roles?: string[];
  assignments?: TeamRoleAssignment[];
  deactivatedAt: string | null;
  approvalPinSet: boolean;
}

export interface TeamRoleAssignment {
  id: string;
  role: string;
  assignmentType: "PERMANENT" | "TEMPORARY";
  branchId: string | null;
  startsAt: string;
  expiresAt: string | null;
  assignedBy: string;
  assignedAt: string;
  assignmentReason: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revocationReason: string | null;
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
  const hasActiveManagerAssignment = (member.assignments ?? []).some((assignment) => assignment.role === "manager" && isActiveAssignment(assignment));
  return member.deactivatedAt === null && (member.role === "owner" || member.role === "manager" || hasActiveManagerAssignment);
}

export function isActiveAssignment(assignment: TeamRoleAssignment, now = new Date()): boolean {
  return assignment.revokedAt === null && new Date(assignment.startsAt).getTime() <= now.getTime() &&
    (assignment.expiresAt === null || new Date(assignment.expiresAt).getTime() > now.getTime());
}
