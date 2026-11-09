export interface TurnstileVerifyOptions {
  secretKey: string;
  token: string;
  remoteIp?: string | null;
  idempotencyKey?: string | null;
  siteverifyEndpoint?: string;
}

export interface TurnstileVerifyResult {
  success: boolean;
  challengeTs?: string | undefined;
  hostname?: string | undefined;
  errorCodes?: string[] | undefined;
  action?: string | undefined;
  cdata?: string | undefined;
}

// Official Cloudflare Turnstile test keys for CI/dev
export const TURNSTILE_TEST_SECRET_ALWAYS_PASSES = "1x0000000000000000000000000000000AA";
export const TURNSTILE_TEST_SECRET_ALWAYS_FAILS = "2x0000000000000000000000000000000AA";
export const TURNSTILE_TEST_SECRET_TOKEN_ALREADY_SPENT = "3x0000000000000000000000000000000AA";

export const DEFAULT_TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verifies a Cloudflare Turnstile response token with the Siteverify API.
 */
export async function verifyTurnstileToken(
  opts: TurnstileVerifyOptions,
  customFetch: typeof fetch = fetch
): Promise<TurnstileVerifyResult> {
  const fetchFn = customFetch;
  const endpoint = opts.siteverifyEndpoint ?? DEFAULT_TURNSTILE_SITEVERIFY_URL;

  const formData = new FormData();
  formData.append("secret", opts.secretKey);
  formData.append("response", opts.token);

  if (opts.remoteIp) {
    formData.append("remoteip", opts.remoteIp);
  }
  if (opts.idempotencyKey) {
    formData.append("idempotency_key", opts.idempotencyKey);
  }

  try {
    const res = await fetchFn(endpoint, {
      method: "POST",
      body: formData
    });

    if (!res.ok) {
      return {
        success: false,
        errorCodes: [`http-status-${res.status}`]
      };
    }

    const data = (await res.json()) as {
      success: boolean;
      challenge_ts?: string;
      hostname?: string;
      "error-codes"?: string[];
      action?: string;
      cdata?: string;
    };

    return {
      success: Boolean(data.success),
      challengeTs: data.challenge_ts,
      hostname: data.hostname,
      errorCodes: data["error-codes"],
      action: data.action,
      cdata: data.cdata
    };
  } catch {
    return {
      success: false,
      errorCodes: ["network-error"]
    };
  }
}
