/**
 * Verschlüsselung der lokalen Ablage im Browser (Issue #348), ohne IndexedDB und ohne DOM.
 *
 * - Schlüssel: AES-GCM 256, per HKDF-SHA-256 aus dem Sitzungsmaterial des Servers und
 *   einem zufälligen Salz der lokalen Datenbank abgeleitet. Der CryptoKey ist nicht
 *   exportierbar (extractable: false); das Rohmaterial wird nach dem Import mit Nullen
 *   überschrieben und nirgends gespeichert.
 * - Nonce: 96 Bit aus crypto.getRandomValues je Verschlüsselung. Höchstens 2^32
 *   Verschlüsselungen je Schlüssel und Seite (NIST SP 800-38D, Abschnitt 8.3); danach
 *   verweigert der Cipher weitere Aufrufe.
 * - AAD: Format-Version, Bereich und Datensatz-ID. Ein Chiffrat lässt sich damit nicht
 *   unbemerkt unter einer anderen ID oder in einem anderen Bereich einspielen.
 */

export const LOCAL_FORMAT_VERSION = 1;
export const LOCAL_KEY_BYTES = 32;
export const LOCAL_SALT_BYTES = 16;
export const IV_BYTES = 12;
/** Obergrenze für zufällige 96-Bit-Nonces unter einem Schlüssel (SP 800-38D, 8.3). */
export const MAX_ENCRYPTIONS_PER_KEY = 2 ** 32;

const HKDF_INFO = new TextEncoder().encode("relationnotes/local-idb/aes-gcm-256/v1");

export type LocalCryptoErrorCode = "key-material" | "format" | "decrypt" | "nonce-limit";

export class LocalCryptoError extends Error {
  constructor(readonly code: LocalCryptoErrorCode) {
    super(`local-crypto: ${code}`);
    this.name = "LocalCryptoError";
  }
}

/** Gespeicherte Form eines verschlüsselten Werts. */
export interface EncryptedEnvelope {
  readonly v: number;
  readonly iv: Uint8Array;
  readonly ct: Uint8Array;
}

/**
 * Leitet den nicht exportierbaren AES-GCM-Schlüssel ab. Das übergebene Material wird
 * danach mit Nullen überschrieben, auch wenn die Ableitung scheitert.
 */
export async function deriveLocalKey(
  material: Uint8Array,
  salt: Uint8Array,
  subtle: SubtleCrypto = crypto.subtle
): Promise<CryptoKey> {
  try {
    if (material.byteLength !== LOCAL_KEY_BYTES || salt.byteLength !== LOCAL_SALT_BYTES) {
      throw new LocalCryptoError("key-material");
    }
    const base = await subtle.importKey("raw", material, "HKDF", false, ["deriveKey"]);
    return await subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt, info: HKDF_INFO },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  } finally {
    material.fill(0);
  }
}

/** Zusätzliche authentifizierte Daten: als JSON-Array, damit keine Trennzeichen kollidieren. */
export function buildAad(area: string, id: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(["rn-local", LOCAL_FORMAT_VERSION, area, id]));
}

export function isEnvelope(value: unknown): value is EncryptedEnvelope {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.v === LOCAL_FORMAT_VERSION &&
    record.iv instanceof Uint8Array &&
    record.iv.byteLength === IV_BYTES &&
    record.ct instanceof Uint8Array
  );
}

export interface LocalCipherOptions {
  readonly subtle?: SubtleCrypto | undefined;
  /** Nur für Tests: eigene Zufallsquelle. */
  readonly randomFill?: ((bytes: Uint8Array) => void) | undefined;
  /** Nur für Tests: niedrigere Obergrenze. */
  readonly maxEncryptions?: number | undefined;
}

/** Ver- und Entschlüsseln mit einem festen Schlüssel; zählt die vergebenen Nonces. */
export class LocalCipher {
  private count = 0;
  private readonly subtle: SubtleCrypto;
  private readonly randomFill: (bytes: Uint8Array) => void;
  private readonly maxEncryptions: number;

  constructor(
    private readonly key: CryptoKey,
    options: LocalCipherOptions = {}
  ) {
    this.subtle = options.subtle ?? crypto.subtle;
    this.randomFill = options.randomFill ?? ((bytes) => crypto.getRandomValues(bytes));
    this.maxEncryptions = options.maxEncryptions ?? MAX_ENCRYPTIONS_PER_KEY;
  }

  async encrypt(aad: Uint8Array, plaintext: Uint8Array): Promise<EncryptedEnvelope> {
    if (this.count >= this.maxEncryptions) throw new LocalCryptoError("nonce-limit");
    this.count += 1;
    const iv = new Uint8Array(IV_BYTES);
    this.randomFill(iv);
    const ct = await this.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
      this.key,
      plaintext
    );
    return { v: LOCAL_FORMAT_VERSION, iv, ct: new Uint8Array(ct) };
  }

  async decrypt(aad: Uint8Array, envelope: unknown): Promise<Uint8Array> {
    if (!isEnvelope(envelope)) throw new LocalCryptoError("format");
    try {
      const plain = await this.subtle.decrypt(
        { name: "AES-GCM", iv: envelope.iv, additionalData: aad, tagLength: 128 },
        this.key,
        envelope.ct
      );
      return new Uint8Array(plain);
    } catch {
      throw new LocalCryptoError("decrypt");
    }
  }

  async encryptJson(aad: Uint8Array, value: unknown): Promise<EncryptedEnvelope> {
    return this.encrypt(aad, new TextEncoder().encode(JSON.stringify(value)));
  }

  async decryptJson<T>(aad: Uint8Array, envelope: unknown): Promise<T> {
    const plain = await this.decrypt(aad, envelope);
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  }
}
