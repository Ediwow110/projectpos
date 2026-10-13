export interface RequestAuth {
  userId: string;
  businessId: string;
  role: string;
  sessionId: string;
  activeBranchId: string | null;
  authenticatedAt: Date;
  effectivePermissions?: string[];
  /** Null means unassigned/legacy all-branch access; [] means deny all. */
  allowedBranchIds?: string[] | null;
  allowedRegisterIds?: string[] | null;
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
