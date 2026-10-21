export type ChallengeConfig = { enabled: boolean; siteKey?: string };

/** `error` means the lookup was refused or never landed. It is deliberately not the same
 * as a server that answered `{ enabled: false }`: treating the two alike tells the operator
 * that resend protection is on the server rate limit when nothing was ever confirmed. */
export type ChallengeLookup =
  | { status: "ready"; enabled: boolean; siteKey?: string }
  | { status: "error" };

export async function resolveChallengeLookup(
  fetcher: () => Promise<ChallengeConfig>,
): Promise<ChallengeLookup> {
  try {
    const config = await fetcher();
    return { status: "ready", enabled: config.enabled, siteKey: config.siteKey };
  } catch {
    return { status: "error" };
  }
}
