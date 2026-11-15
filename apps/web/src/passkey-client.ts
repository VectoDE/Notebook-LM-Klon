/**
 * Passkey-Registrierung im Browser (Issue #343).
 *
 * Ablauf: Optionen beim Worker holen (mit Turnstile-Token, der Worker prüft fail-closed),
 * WebAuthn im Browser ausführen, Ergebnis zur Prüfung zurückschicken. Die Umwandlung
 * zwischen JSON (base64url) und ArrayBuffer steht hier, damit keine weitere Abhängigkeit
 * nötig ist.
 */
import type { AuthCallResult } from "./turnstile-client.js";

/** base64url (ohne Padding) in Bytes. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Bytes in base64url ohne Padding. */
export function bytesToBase64Url(buffer: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface CredentialDescriptorJSON {
  readonly id: string;
  readonly type?: string;
  readonly transports?: readonly string[];
}

/** Registrierungsoptionen, wie sie der Worker (@simplewebauthn/server) liefert. */
export interface CreationOptionsJSON {
  readonly challenge: string;
  readonly rp: { readonly name: string; readonly id?: string };
  readonly user: { readonly id: string; readonly name: string; readonly displayName: string };
  readonly pubKeyCredParams: readonly { readonly type: string; readonly alg: number }[];
  readonly timeout?: number;
  readonly excludeCredentials?: readonly CredentialDescriptorJSON[];
  readonly authenticatorSelection?: AuthenticatorSelectionCriteria;
  readonly attestation?: AttestationConveyancePreference;
}

/** JSON-Optionen in die Struktur, die navigator.credentials.create erwartet. */
export function toCreationOptions(json: CreationOptionsJSON): PublicKeyCredentialCreationOptions {
  const options: PublicKeyCredentialCreationOptions = {
    challenge: base64UrlToBytes(json.challenge),
    rp: json.rp,
    user: {
      id: base64UrlToBytes(json.user.id),
      name: json.user.name,
      displayName: json.user.displayName
    },
    pubKeyCredParams: json.pubKeyCredParams.map((p) => ({
      type: p.type as PublicKeyCredentialType,
      alg: p.alg
    })),
    excludeCredentials: (json.excludeCredentials ?? []).map((c) => ({
      id: base64UrlToBytes(c.id),
      type: "public-key",
      ...(c.transports ? { transports: [...c.transports] as AuthenticatorTransport[] } : {})
    }))
  };
  if (json.timeout !== undefined) options.timeout = json.timeout;
  if (json.authenticatorSelection) options.authenticatorSelection = json.authenticatorSelection;
  if (json.attestation) options.attestation = json.attestation;
  return options;
}

/** Ausschnitt des Browser-Credentials, den die Umwandlung braucht. */
export interface AttestationCredential {
  readonly id: string;
  readonly rawId: ArrayBuffer;
  readonly type: string;
  readonly authenticatorAttachment?: string | null;
  readonly response: {
    readonly clientDataJSON: ArrayBuffer;
    readonly attestationObject: ArrayBuffer;
    getTransports?: () => string[];
  };
  getClientExtensionResults(): AuthenticationExtensionsClientOutputs;
}

/** Browser-Credential in das JSON, das der Worker unter /register/verify prüft. */
export function toRegistrationJSON(credential: AttestationCredential): Record<string, unknown> {
  const transports = credential.response.getTransports?.() ?? [];
  return {
    id: credential.id,
    rawId: bytesToBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: bytesToBase64Url(credential.response.clientDataJSON),
      attestationObject: bytesToBase64Url(credential.response.attestationObject),
      transports
    }
  };
}

async function readProblemCode(res: Response): Promise<string> {
  try {
    const problem = (await res.json()) as { code?: unknown };
    if (typeof problem.code === "string") return problem.code;
  } catch {
    // kein JSON: Status melden
  }
  return `HTTP_${res.status}`;
}

async function postJson(
  fetchFn: typeof fetch,
  path: string,
  body: unknown
): Promise<{ ok: true; data: unknown } | { ok: false; code: string }> {
  let res: Response;
  try {
    res = await fetchFn(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch {
    return { ok: false, code: "NETWORK_ERROR" };
  }
  if (!res.ok) return { ok: false, code: await readProblemCode(res) };
  try {
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, code: `HTTP_${res.status}` };
  }
}

/** Minimale Schnittstelle zu navigator.credentials (in Tests ersetzbar). */
export interface PasskeyCredentials {
  create(options: CredentialCreationOptions): Promise<Credential | null>;
}

/**
 * Registriert einen Passkey für die aktuelle Sitzung. Das Turnstile-Token geht mit der
 * Options-Anfrage an den Worker; ohne gültiges Token gibt es keine Challenge.
 */
export async function registerPasskey(
  fetchFn: typeof fetch,
  credentials: PasskeyCredentials | undefined,
  turnstileToken: string
): Promise<AuthCallResult> {
  if (!credentials || typeof PublicKeyCredential === "undefined") {
    return { ok: false, code: "PASSKEY_NOT_SUPPORTED" };
  }

  const optionsRes = await postJson(fetchFn, "/api/v1/auth/passkey/register/options", {
    turnstileToken
  });
  if (!optionsRes.ok) return optionsRes;

  let credential: Credential | null;
  try {
    credential = await credentials.create({
      publicKey: toCreationOptions(optionsRes.data as CreationOptionsJSON)
    });
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name;
    return {
      ok: false,
      code:
        name === "NotAllowedError" || name === "AbortError" ? "PASSKEY_CANCELLED" : "PASSKEY_FAILED"
    };
  }
  if (!credential) return { ok: false, code: "PASSKEY_CANCELLED" };

  const verifyRes = await postJson(
    fetchFn,
    "/api/v1/auth/passkey/register/verify",
    toRegistrationJSON(credential as unknown as AttestationCredential)
  );
  return verifyRes.ok ? { ok: true } : verifyRes;
}
