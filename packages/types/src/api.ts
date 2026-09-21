export interface ApiErrorEnvelope {
  code: string;
  message: string;
  correlationId: string;
  fields?: Record<string, string[]>;
}

export interface CursorPaginationParams {
  cursor?: string;
  limit: number;
}

export interface PagePaginationParams {
  page: number;
  pageSize: number;
}

export function utcNowIso(): string {
  return new Date().toISOString();
}
