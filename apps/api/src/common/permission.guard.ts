import { CanActivate, ExecutionContext, Injectable, mixin } from "@nestjs/common";
import { hasPermission } from "@pos/auth";

export function RequirePermission(permission: string): ReturnType<typeof mixin> {
  @Injectable()
  class PermissionGuardMixin implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest();
      const auth = req.auth;
      if (!auth) {
        req.authError = "TENANT_REQUIRED";
        return false;
      }
      const granted: string[] = req.rolePermissions ?? [];
      if (!hasPermission(granted, permission, auth.businessId, auth.businessId)) {
        req.authError = "FORBIDDEN";
        return false;
      }
      return true;
    }
  }
  return mixin(PermissionGuardMixin);
}
