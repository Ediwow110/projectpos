import { CanActivate, ExecutionContext, Injectable, Optional } from "@nestjs/common";

function normalizeOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

@Injectable()
export class FirstPartyOriginGuard implements CanActivate {
  private readonly expectedOrigin: string | null;

  constructor(@Optional() source?: NodeJS.ProcessEnv) {
    this.expectedOrigin = normalizeOrigin((source ?? process.env)["WEB_URL"]);
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      authError?: string;
    }>();
    const raw = req.headers["origin"];
    const origin = Array.isArray(raw) ? raw[0] : raw;
    const actual = normalizeOrigin(origin);
    if (!this.expectedOrigin || !actual || actual !== this.expectedOrigin) {
      req.authError = "FORBIDDEN";
      return false;
    }
    return true;
  }
}
