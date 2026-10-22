/**
 * The API is the authority on what a session may do. GET /api/v1/me returns the
 * session's effective permission list, which already accounts for the role seed
 * and for per-member denials. The web app reads that list instead of re-deriving
 * authorization from a role name, so the two cannot drift apart.
 */
export function hasPermission(granted: readonly string[] | undefined, required: string): boolean {
  return granted?.includes(required) === true;
}
