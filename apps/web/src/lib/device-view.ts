export interface DeviceFleetRow {
  id: string;
  userId: string;
  label: string;
  revokedAt: string | null;
}

export function deviceStatusLabel(revokedAt: string | null): "Active" | "Revoked" {
  return revokedAt === null ? "Active" : "Revoked";
}

export function isCurrentDevice(deviceId: string, currentDeviceId: string | null): boolean {
  return currentDeviceId !== null && deviceId === currentDeviceId;
}

export function shortDeviceId(deviceId: string): string {
  return deviceId.length > 11 ? deviceId.slice(0, 10) + "…" : deviceId;
}
