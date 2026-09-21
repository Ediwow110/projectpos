export interface DbUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
}

export interface DbBusiness {
  id: string;
  name: string;
  currency: string;
}

export interface DbMembership {
  id: string;
  businessId: string;
  userId: string;
  role: string;
}

export interface DbSession {
  id: string;
  userId: string;
  businessId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  authenticatedAt: Date;
  ip: string | null;
  userAgent: string | null;
}

export interface DbResetToken {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  requestId: string;
  ip: string | null;
}

export interface AuditEntry {
  businessId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  requestId: string;
}

export interface DbPort {
  findUserByEmail(email: string): Promise<DbUser | null>;
  findUserById(id: string): Promise<DbUser | null>;
  createUser(u: Omit<DbUser, "id">): Promise<DbUser>;
  updateUserPassword(id: string, passwordHash: string): Promise<void>;
  createBusiness(b: Omit<DbBusiness, "id">): Promise<DbBusiness>;
  findBusinessById(id: string): Promise<DbBusiness | null>;
  listMembershipsByUser(userId: string): Promise<DbMembership[]>;
  findMembership(userId: string, businessId: string): Promise<DbMembership | null>;
  createMembership(m: Omit<DbMembership, "id">): Promise<DbMembership>;
  createSession(s: Omit<DbSession, "id">): Promise<DbSession>;
  findSessionByTokenHash(tokenHash: string): Promise<DbSession | null>;
  listSessionsByUser(userId: string): Promise<DbSession[]>;
  revokeSession(id: string): Promise<void>;
  revokeAllUserSessions(userId: string, exceptId?: string): Promise<void>;
  saveResetToken(t: DbResetToken): Promise<void>;
  findResetToken(tokenHash: string): Promise<DbResetToken | null>;
  markResetTokenUsed(tokenHash: string, usedAt: Date): Promise<void>;
  getSettings(businessId: string): Promise<Record<string, unknown>>;
  saveSettings(businessId: string, settings: Record<string, unknown>): Promise<void>;
  appendAudit(e: AuditEntry): Promise<void>;
  listAudit(): Promise<AuditEntry[]>;
}
