export interface LogFields {
  correlationId: string;
  businessId?: string;
  userId?: string;
  action?: string;
}

export function createLogger() {
  return {
    info(fields: LogFields, message: string): string {
      return JSON.stringify({ level: "info", message, ...fields, timestamp: new Date().toISOString() });
    },
  };
}
