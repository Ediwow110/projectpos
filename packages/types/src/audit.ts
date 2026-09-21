export interface AuditLogShape {
  businessId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeSnapshot: unknown | null;
  afterSnapshot: unknown | null;
  reason: string | null;
  requestId: string;
  ip: string | null;
  timestamp: string;
}
