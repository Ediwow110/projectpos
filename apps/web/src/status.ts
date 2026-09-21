export interface MePayload {
  businessId: string;
  userId: string;
  requestId: string;
  timestamp: string;
}

export type Fetcher = () => Promise<MePayload>;

export async function fetchStatus(
  _apiBase: string,
  fetcher: Fetcher,
): Promise<{ ok: boolean; me?: MePayload; error?: string }> {
  try {
    const me = await fetcher();
    if (!me.businessId) return { ok: false, error: "TENANT_REQUIRED" };
    return { ok: true, me };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "UNKNOWN" };
  }
}
