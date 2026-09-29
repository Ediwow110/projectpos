export interface RequestAuth {
  userId: string;
  businessId: string;
  role: string;
  sessionId: string;
  activeBranchId: string | null;
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
