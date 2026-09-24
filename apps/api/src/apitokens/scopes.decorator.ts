import { SetMetadata } from "@nestjs/common";

export const SCOPES_KEY = "apitoken:scopes";

export const Scopes = (...scopes: string[]) => SetMetadata(SCOPES_KEY, scopes);

export function scopesSatisfied(required: string[], granted: string[]): boolean {
  return required.every((s) => granted.includes(s));
}
