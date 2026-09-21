export interface RequestAuth {
  userId: string;
  businessId: string;
  role: string;
  sessionId: string;
  authenticatedAt: Date;
}

declare global {
  namespace Express {
    interface Request {
      auth?: RequestAuth;
      authError?: string;
      rolePermissions?: string[];
      correlationId?: string;
    }
  }
}

export {};
