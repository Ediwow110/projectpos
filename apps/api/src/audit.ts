export interface AuditWrite {
  businessId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  requestId: string;
}

const store: AuditWrite[] = [];

export function appendAudit(entry: AuditWrite): AuditWrite {
  store.push(entry);
  return entry;
}

export function listAudit(): readonly AuditWrite[] {
  return store;
}

export function clearAudit(): void {
  store.length = 0;
}
