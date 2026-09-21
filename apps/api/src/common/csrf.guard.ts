import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { verifyCsrfToken } from "../auth/csrf";

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!req.cookies?.pos_session) return true;
    try {
      verifyCsrfToken(req.cookies?.pos_csrf ?? "", req.headers?.["x-csrf-token"]);
      return true;
    } catch {
      req.authError = "CSRF_MISMATCH";
      return false;
    }
  }
}
