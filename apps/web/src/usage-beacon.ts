/**
 * Cookie-free usage beacon (Issue #262).
 *
 * Sends one aggregated count per page load to the worker (POST /api/v1/metrics).
 * The request carries no cookie (credentials: "omit"), no identifier and reads or
 * writes nothing on the device (no cookie, no localStorage). Browsers that signal
 * Global Privacy Control or Do Not Track are not counted at all.
 */
export const USAGE_ENDPOINT = "/api/v1/metrics";

export interface PrivacySignals {
  readonly doNotTrack?: string | null | undefined;
  readonly globalPrivacyControl?: boolean | undefined;
}

export interface UsageBeaconEnvironment {
  readonly fetch: typeof fetch;
  readonly navigator: PrivacySignals;
  /** Only production builds send the beacon (the dev server has no worker). */
  readonly production: boolean;
}

/** True unless the browser asks not to be tracked (GPC or DNT). */
export function allowsUsageCount(signals: PrivacySignals): boolean {
  return signals.globalPrivacyControl !== true && signals.doNotTrack !== "1";
}

export async function sendUsageBeacon(env: UsageBeaconEnvironment): Promise<boolean> {
  if (!env.production || !allowsUsageCount(env.navigator)) {
    return false;
  }
  try {
    const res = await env.fetch(USAGE_ENDPOINT, {
      method: "POST",
      credentials: "omit",
      keepalive: true,
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ metric: "page_view" })
    });
    return res.ok;
  } catch {
    return false;
  }
}
