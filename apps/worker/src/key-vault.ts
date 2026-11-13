import type { ProviderType } from "@notebook-lm/shared";

export interface KeyVaultConfig {
  /**
   * Primary KEK or versioned map of KEKs.
   * KEKs can be supplied as:
   * - 32-byte raw Uint8Array (AES-256)
   * - 64-character hex string (32 bytes)
   * - 44-character base64 string (32 bytes)
   * - UTF-8 string (will be derived to 32 bytes via SHA-256)
   */
  keks: Record<number, string | Uint8Array>;
  currentVersion?: number | undefined;
}

export interface EncryptedApiKeyPayload {
  version: number;
  iv: string; // Base64
  ciphertext: string; // Base64 (ciphertext + auth tag)
}

/**
 * Builds deterministic AAD (Additional Authenticated Data) for BYOK encryption:
 * AAD = UTF8(userId | provider | keyVersion)
 */
export function buildBYOKAdditionalData(
  userId: string,
  provider: ProviderType,
  keyVersion: number
): Uint8Array {
  const aadString = `${userId}|${provider}|v${keyVersion}`;
  return new TextEncoder().encode(aadString);
}

/**
 * Converts a raw KEK secret (string or Uint8Array) into a 32-byte WebCrypto AES-GCM CryptoKey.
 */
export async function importKek(secret: string | Uint8Array): Promise<CryptoKey> {
  let keyBytes: Uint8Array;

  if (secret instanceof Uint8Array) {
    if (secret.length === 32) {
      keyBytes = secret;
    } else {
      const digest = await crypto.subtle.digest("SHA-256", secret as Uint8Array<ArrayBuffer>);
      keyBytes = new Uint8Array(digest);
    }
  } else if (typeof secret === "string") {
    const trimmed = secret.trim();
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      // 32-byte hex string
      const match = trimmed.match(/.{1,2}/g);
      /* v8 ignore next */
      keyBytes = new Uint8Array((match ?? []).map((byte) => Number.parseInt(byte, 16)));
    } else if (
      /^[A-Za-z0-9+/]{43}=$/.test(trimmed) ||
      /^[A-Za-z0-9+/]{42}==$/.test(trimmed) ||
      /^[A-Za-z0-9+/]{44}$/.test(trimmed)
    ) {
      // Base64 string
      const binStr = atob(trimmed);
      if (binStr.length === 32) {
        keyBytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
          keyBytes[i] = binStr.charCodeAt(i);
        }
      } else {
        const encoded = new TextEncoder().encode(trimmed);
        const digest = await crypto.subtle.digest("SHA-256", encoded as Uint8Array<ArrayBuffer>);
        keyBytes = new Uint8Array(digest);
      }
    } else {
      // Arbitrary passphrase - hash with SHA-256 to produce exactly 256 bits
      const encoded = new TextEncoder().encode(trimmed);
      const digest = await crypto.subtle.digest("SHA-256", encoded);
      keyBytes = new Uint8Array(digest);
    }
  } else {
    throw new Error("Invalid KEK secret type: expected string or Uint8Array.");
  }

  return crypto.subtle.importKey(
    "raw",
    keyBytes as Uint8Array<ArrayBuffer>,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Serializes encrypted payload to a compact JSON string stored in DB `encrypted_key`.
 */
export function serializeEncryptedPayload(payload: EncryptedApiKeyPayload): string {
  return JSON.stringify(payload);
}

/**
 * Deserializes encrypted payload from JSON string or throws on corrupt format.
 */
export function deserializeEncryptedPayload(serialized: string): EncryptedApiKeyPayload {
  try {
    const parsed = JSON.parse(serialized) as EncryptedApiKeyPayload;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.version === "number" &&
      typeof parsed.iv === "string" &&
      typeof parsed.ciphertext === "string"
    ) {
      return parsed;
    }
  } catch {
    // handled by error below
  }
  throw new Error("Corrupted or invalid encrypted_key payload structure.");
}

/**
 * Converts Uint8Array to standard Base64 string.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i] as number);
  }
  return btoa(bin);
}

/**
 * Converts standard Base64 string to Uint8Array.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

/**
 * KeyVault handles AES-256-GCM Envelope Encryption, Decryption,
 * and Key Rotation with deterministic AAD binding.
 */
export class KeyVault {
  private readonly kekSecrets: Map<number, string | Uint8Array>;
  private readonly activeVersion: number;

  constructor(config: KeyVaultConfig) {
    this.kekSecrets = new Map();
    for (const [vStr, secret] of Object.entries(config.keks)) {
      const v = Number(vStr);
      if (!Number.isNaN(v) && v > 0) {
        this.kekSecrets.set(v, secret);
      }
    }

    if (this.kekSecrets.size === 0) {
      throw new Error("KeyVault requires at least one KEK secret.");
    }

    if (config.currentVersion !== undefined) {
      if (!this.kekSecrets.has(config.currentVersion)) {
        throw new Error(
          `Current KEK version ${config.currentVersion} is not present in provided KEKs.`
        );
      }
      this.activeVersion = config.currentVersion;
    } else {
      // Default to the highest version number
      this.activeVersion = Math.max(...Array.from(this.kekSecrets.keys()));
    }
  }

  getCurrentVersion(): number {
    return this.activeVersion;
  }

  hasVersion(version: number): boolean {
    return this.kekSecrets.has(version);
  }

  /**
   * Encrypts a plaintext API key using AES-256-GCM with a random 96-bit IV
   * and AAD binding to (userId, provider, keyVersion).
   */
  async encrypt(
    plaintextKey: string,
    context: { userId: string; provider: ProviderType; version?: number }
  ): Promise<EncryptedApiKeyPayload> {
    const version = context.version ?? this.activeVersion;
    const kekSecret = this.kekSecrets.get(version);
    if (!kekSecret) {
      throw new Error(`Cannot encrypt: KEK version ${version} not found in KeyVault.`);
    }

    const kek = await importKek(kekSecret);

    // 96-bit CSPRNG IV (12 bytes)
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);

    // Deterministic AAD binding: userId|provider|v{version}
    const aad = buildBYOKAdditionalData(context.userId, context.provider, version);
    const plaintextBytes = new TextEncoder().encode(plaintextKey);

    const ciphertextBuffer = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: aad as Uint8Array<ArrayBuffer>
      },
      kek,
      plaintextBytes
    );

    return {
      version,
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertextBuffer))
    };
  }

  /**
   * Decrypts an encrypted payload using the appropriate KEK version
   * and verifies AAD binding.
   * Throws if AAD does not match (tampering detected) or key is invalid.
   */
  async decrypt(
    payload: EncryptedApiKeyPayload,
    context: { userId: string; provider: ProviderType }
  ): Promise<string> {
    const kekSecret = this.kekSecrets.get(payload.version);
    if (!kekSecret) {
      throw new Error(`Cannot decrypt: KEK version ${payload.version} not found in KeyVault.`);
    }

    const kek = await importKek(kekSecret);
    const iv = base64ToBytes(payload.iv);
    const ciphertextBytes = base64ToBytes(payload.ciphertext);

    // Reconstruct exact AAD: userId|provider|v{payload.version}
    const aad = buildBYOKAdditionalData(context.userId, context.provider, payload.version);

    try {
      const decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv as Uint8Array<ArrayBuffer>,
          additionalData: aad as Uint8Array<ArrayBuffer>
        },
        kek,
        ciphertextBytes as Uint8Array<ArrayBuffer>
      );

      return new TextDecoder().decode(decryptedBuffer);
    } catch {
      throw new Error(
        "Decryption failed: cryptographic integrity check failed (possible tampering or invalid KEK)."
      );
    }
  }

  /**
   * Rekey routine: Decrypts with existing version and re-encrypts with targetVersion.
   * Returns newly encrypted payload with updated version.
   */
  async rekey(
    payload: EncryptedApiKeyPayload,
    context: { userId: string; provider: ProviderType },
    targetVersion?: number
  ): Promise<EncryptedApiKeyPayload> {
    const newVersion = targetVersion ?? this.activeVersion;
    if (payload.version === newVersion) {
      return payload; // Already on target version
    }

    const plaintext = await this.decrypt(payload, context);
    return this.encrypt(plaintext, {
      userId: context.userId,
      provider: context.provider,
      version: newVersion
    });
  }
}

/**
 * Minimum length of a KEK secret taken from the environment. 32 characters cover the
 * documented formats (64 hex chars or 44 base64 chars for 32 random bytes) and reject
 * short, guessable passphrases that SHA-256 would otherwise silently stretch.
 */
export const MIN_KEK_SECRET_LENGTH = 32;

/** Names of the environment variables that may hold a KEK. */
export const KEK_ENV_NAMES: readonly string[] = [
  ...Array.from({ length: 10 }, (_, i) => `KEK_V${i + 1}`),
  "BYOK_MASTER_KEY"
];

/** Returns true when the value is a string that is long enough to be used as a KEK. */
export function isUsableKekSecret(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= MIN_KEK_SECRET_LENGTH;
}

/**
 * Reads one KEK variable. Blank or absent → undefined. Present but too short → throws,
 * so a weak secret is never used and never silently skipped.
 */
function readKekSecret(envRecord: Record<string, unknown>, name: string): string | undefined {
  const value = envRecord[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  if (!isUsableKekSecret(value)) {
    throw new Error(
      `KEK ${name} is too short: use at least ${MIN_KEK_SECRET_LENGTH} characters (e.g. 32 random bytes as 64 hex or 44 base64 characters).`
    );
  }
  return value.trim();
}

/**
 * Creates a KeyVault from Worker environment bindings or process.env.
 * Checks KEK_V1, KEK_V2, KEK_V3, ..., and BYOK_MASTER_KEY as fallback.
 * Throws if no KEK is configured (no built-in default, in any environment)
 * and if a configured KEK is shorter than MIN_KEK_SECRET_LENGTH.
 */
export function createKeyVaultFromEnv(env: Record<string, unknown> | Env): KeyVault {
  const envRecord = env as Record<string, unknown>;
  const keks: Record<number, string | Uint8Array> = {};

  // Check versioned KEKs (KEK_V1, KEK_V2, ...)
  for (let v = 1; v <= 10; v++) {
    const key = readKekSecret(envRecord, `KEK_V${v}`);
    if (key !== undefined) {
      keks[v] = key;
    }
  }

  // Fallback to BYOK_MASTER_KEY as v1 if no versioned KEKs found
  if (Object.keys(keks).length === 0) {
    const master = readKekSecret(envRecord, "BYOK_MASTER_KEY");
    if (master !== undefined) {
      keks[1] = master;
    }
  }

  // Fail closed: never fall back to a built-in key. A hard-coded KEK is public
  // (it lives in the repository) and would silently make every stored BYOK
  // ciphertext decryptable by anyone with database access.
  if (Object.keys(keks).length === 0) {
    throw new Error(
      "No KEK configured: set KEK_V1 (or KEK_V2 … KEK_V10, or BYOK_MASTER_KEY) as a secret before using BYOK encryption."
    );
  }

  const activeVersionStr = envRecord.KEK_CURRENT_VERSION;
  const currentVersion =
    (typeof activeVersionStr === "string" && activeVersionStr.trim().length > 0) ||
    typeof activeVersionStr === "number"
      ? Number(activeVersionStr)
      : undefined;

  return new KeyVault({ keks, currentVersion });
}
