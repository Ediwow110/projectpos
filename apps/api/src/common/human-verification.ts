export const HUMAN_VERIFICATION_PORT = "HumanVerificationPort";

export interface HumanVerificationPort {
  readonly enabled: boolean;
  readonly siteKey: string | null;
  verify(input: { token: string; ip: string | null; action: string }): Promise<boolean>;
}

export const DISABLED_HUMAN_VERIFICATION: HumanVerificationPort = {
  enabled: false,
  siteKey: null,
  async verify(): Promise<boolean> {
    return true;
  },
};

interface TurnstileResponse {
  success?: boolean;
  action?: string;
  hostname?: string;
}

export function createHumanVerificationFromEnv(
  source: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): HumanVerificationPort {
  const siteKey = source["TURNSTILE_SITE_KEY"]?.trim() ?? "";
  const secretKey = source["TURNSTILE_SECRET_KEY"]?.trim() ?? "";

  if (!siteKey && !secretKey) return DISABLED_HUMAN_VERIFICATION;
  if (!siteKey || !secretKey) throw new Error("ENV_INVALID_TURNSTILE_CONFIG");

  let expectedHostname: string | null = null;
  const webUrl = source["WEB_URL"]?.trim();
  if (webUrl) {
    try {
      expectedHostname = new URL(webUrl).hostname;
    } catch {
      throw new Error("ENV_INVALID_TURNSTILE_CONFIG");
    }
  }

  return {
    enabled: true,
    siteKey,
    async verify(input): Promise<boolean> {
      if (!input.token.trim()) return false;
      try {
        const response = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            secret: secretKey,
            response: input.token,
            ...(input.ip ? { remoteip: input.ip } : {}),
          }),
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) return false;
        const result = (await response.json()) as TurnstileResponse;
        if (!result.success || result.action !== input.action) return false;
        if (expectedHostname && result.hostname !== expectedHostname) return false;
        return true;
      } catch {
        return false;
      }
    },
  };
}
