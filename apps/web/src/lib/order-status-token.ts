export interface StatusLocationLike {
  hash: string;
}

export interface StatusHistoryLike {
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

export function consumeStatusTokenFromLocation(
  location: StatusLocationLike,
  history: StatusHistoryLike,
): string | null {
  if (!location.hash) return null;
  const params = new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : location.hash);
  const token = params.get("token");
  if (!token) return null;
  history.replaceState(null, "", "/order-status");
  return token;
}
