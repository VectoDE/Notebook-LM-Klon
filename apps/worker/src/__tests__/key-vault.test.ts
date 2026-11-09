import { describe, expect, it } from "vitest";
import {
  KeyVault,
  buildBYOKAdditionalData,
  bytesToBase64,
  createKeyVaultFromEnv,
  deserializeEncryptedPayload,
  importKek,
  serializeEncryptedPayload
} from "../key-vault.js";

describe("KeyVault - WebCrypto AES-256-GCM Envelope Encryption (Sub-Issue #92, #94)", () => {
  const KEK_V1 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const KEK_V2 = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

  it("imports raw 32-byte Uint8Array, 64-char hex, 44-char base64, and string passphrases", async () => {
    // 32-byte raw
    const raw32 = new Uint8Array(32).fill(7);
    const key1 = await importKek(raw32);
    expect(key1.type).toBe("secret");

    // Non-32-byte Uint8Array (hashes with SHA-256)
    const raw16 = new Uint8Array(16).fill(3);
    const key2 = await importKek(raw16);
    expect(key2.type).toBe("secret");

    // Hex string
    const key3 = await importKek(KEK_V1);
    expect(key3.type).toBe("secret");

    // Base64 string (32 bytes)
    const b64 = bytesToBase64(raw32);
    const key4 = await importKek(b64);
    expect(key4.type).toBe("secret");

    // 44-character Base64 string that decodes to 31 bytes (falls back to SHA-256)
    const b64Not32 = btoa("a".repeat(31));
    const key5 = await importKek(b64Not32);
    expect(key5.type).toBe("secret");

    // Arbitrary text passphrase
    const key6 = await importKek("my-super-secret-passphrase-not-hex");
    expect(key6.type).toBe("secret");

    // Invalid type
    await expect(importKek(null as unknown as string)).rejects.toThrow("Invalid KEK secret type");
  });

  it("initializes KeyVault and resolves currentVersion properly", () => {
    const vault = new KeyVault({
      keks: { 1: KEK_V1, 2: KEK_V2, invalid: KEK_V1, [-1]: KEK_V1 } as unknown as Record<
        number,
        string
      >
    });
    expect(vault.getCurrentVersion()).toBe(2);
    expect(vault.hasVersion(1)).toBe(true);
    expect(vault.hasVersion(2)).toBe(true);
    expect(vault.hasVersion(3)).toBe(false);

    const vaultExplicit = new KeyVault({
      keks: { 1: KEK_V1, 2: KEK_V2 },
      currentVersion: 1
    });
    expect(vaultExplicit.getCurrentVersion()).toBe(1);

    expect(() => new KeyVault({ keks: {} })).toThrow("at least one KEK");
    expect(() => new KeyVault({ keks: { 1: KEK_V1 }, currentVersion: 99 })).toThrow(
      "not present in provided KEKs"
    );
  });

  it("encrypts and decrypts API key with AES-256-GCM and verifies AAD binding", async () => {
    const vault = new KeyVault({ keks: { 1: KEK_V1 } });
    const originalKey = "sk-ant-api03-abcdef1234567890-test";
    const context = { userId: "usr_alice", provider: "anthropic" as const };

    const encrypted = await vault.encrypt(originalKey, context);
    expect(encrypted.version).toBe(1);
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.ciphertext).toBeDefined();

    // Verify plaintext is NOT in ciphertext or iv
    expect(encrypted.ciphertext).not.toContain(originalKey);
    expect(encrypted.iv).not.toContain(originalKey);

    // Decrypt roundtrip
    const decrypted = await vault.decrypt(encrypted, context);
    expect(decrypted).toBe(originalKey);
  });

  it("generates unique 96-bit IVs for identical plaintext and context", async () => {
    const vault = new KeyVault({ keks: { 1: KEK_V1 } });
    const originalKey = "AIzaSyDummyGeminiKeyValid123456";
    const context = { userId: "usr_bob", provider: "google" as const };

    const enc1 = await vault.encrypt(originalKey, context);
    const enc2 = await vault.encrypt(originalKey, context);

    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);

    expect(await vault.decrypt(enc1, context)).toBe(originalKey);
    expect(await vault.decrypt(enc2, context)).toBe(originalKey);
  });

  it("fails immediately when userId is tampered with (AAD integrity check)", async () => {
    const vault = new KeyVault({ keks: { 1: KEK_V1 } });
    const originalKey = "sk-openai-sample-secret-key-12345";
    const enc = await vault.encrypt(originalKey, {
      userId: "usr_alice",
      provider: "openai"
    });

    // Attempt decryption under another user ID (transplanting attack)
    await expect(vault.decrypt(enc, { userId: "usr_eve", provider: "openai" })).rejects.toThrow(
      "cryptographic integrity check failed"
    );
  });

  it("fails immediately when provider is tampered with (AAD integrity check)", async () => {
    const vault = new KeyVault({ keks: { 1: KEK_V1 } });
    const originalKey = "sk-openai-sample-secret-key-12345";
    const enc = await vault.encrypt(originalKey, {
      userId: "usr_alice",
      provider: "openai"
    });

    // Attempt decryption under another provider
    await expect(
      vault.decrypt(enc, { userId: "usr_alice", provider: "anthropic" })
    ).rejects.toThrow("cryptographic integrity check failed");
  });

  it("fails when ciphertext or auth tag is corrupted", async () => {
    const vault = new KeyVault({ keks: { 1: KEK_V1 } });
    const enc = await vault.encrypt("my-secret-key-12345", {
      userId: "usr_carol",
      provider: "groq"
    });

    // Flip bit in ciphertext
    const rawCt = atob(enc.ciphertext);
    const corruptedCt = btoa(`X${rawCt.slice(1)}`);
    const corruptedPayload = { ...enc, ciphertext: corruptedCt };

    await expect(
      vault.decrypt(corruptedPayload, { userId: "usr_carol", provider: "groq" })
    ).rejects.toThrow("cryptographic integrity check failed");
  });

  it("throws error when trying to decrypt with missing KEK version", async () => {
    const vault = new KeyVault({ keks: { 1: KEK_V1 } });
    const enc = await vault.encrypt("my-secret-key", {
      userId: "usr_dave",
      provider: "mistral"
    });

    const higherVersionPayload = { ...enc, version: 3 };
    await expect(
      vault.decrypt(higherVersionPayload, { userId: "usr_dave", provider: "mistral" })
    ).rejects.toThrow("KEK version 3 not found");
  });

  it("throws error when trying to encrypt with missing explicit KEK version", async () => {
    const vault = new KeyVault({ keks: { 1: KEK_V1 } });
    await expect(
      vault.encrypt("my-secret-key", {
        userId: "usr_dave",
        provider: "mistral",
        version: 5
      })
    ).rejects.toThrow("KEK version 5 not found");
  });

  describe("Key Rotation & Rekeying (Sub-Issue #94)", () => {
    it("rotates key from KEK_V1 to KEK_V2 without data loss", async () => {
      const vault = new KeyVault({
        keks: { 1: KEK_V1, 2: KEK_V2 },
        currentVersion: 2
      });
      const originalKey = "AIzaSyGeminiApiKeyRotationTest1234";
      const context = { userId: "usr_frank", provider: "google" as const };

      // Encrypt initially with version 1
      const encV1 = await vault.encrypt(originalKey, { ...context, version: 1 });
      expect(encV1.version).toBe(1);

      // Verify can be decrypted with version 1
      expect(await vault.decrypt(encV1, context)).toBe(originalKey);

      // Rekey to version 2 (with explicit targetVersion)
      const encV2 = await vault.rekey(encV1, context, 2);
      expect(encV2.version).toBe(2);
      expect(encV2.iv).not.toBe(encV1.iv);

      // Verify decrypted with version 2
      expect(await vault.decrypt(encV2, context)).toBe(originalKey);

      // Rekey using default activeVersion when targetVersion is omitted
      const encV1Again = await vault.encrypt(originalKey, { ...context, version: 1 });
      const encV2Default = await vault.rekey(encV1Again, context);
      expect(encV2Default.version).toBe(2);

      // Rekeying already up-to-date payload returns same payload
      const noop = await vault.rekey(encV2, context, 2);
      expect(noop).toBe(encV2);
    });
  });

  describe("Serialization & Deserialization", () => {
    it("serializes and deserializes EncryptedApiKeyPayload correctly", () => {
      const payload = {
        version: 1,
        iv: "dGVzdC1pdi0xMjM=",
        ciphertext: "Y2lwaGVydGV4dC1wbHVzLXRhZw=="
      };

      const serialized = serializeEncryptedPayload(payload);
      expect(typeof serialized).toBe("string");
      const parsed = deserializeEncryptedPayload(serialized);
      expect(parsed).toEqual(payload);
    });

    it("throws when deserializing corrupt or non-object payloads", () => {
      expect(() => deserializeEncryptedPayload("invalid json")).toThrow("Corrupted or invalid");
      expect(() =>
        deserializeEncryptedPayload(JSON.stringify({ version: "not-a-number" }))
      ).toThrow("Corrupted or invalid");
      expect(() => deserializeEncryptedPayload(JSON.stringify(null))).toThrow(
        "Corrupted or invalid"
      );
    });
  });

  describe("createKeyVaultFromEnv helper", () => {
    it("loads versioned KEK_V1, KEK_V2 and KEK_CURRENT_VERSION from env", () => {
      const vault = createKeyVaultFromEnv({
        KEK_V1,
        KEK_V2,
        KEK_CURRENT_VERSION: "2"
      });
      expect(vault.getCurrentVersion()).toBe(2);
      expect(vault.hasVersion(1)).toBe(true);
      expect(vault.hasVersion(2)).toBe(true);
    });

    it("falls back to BYOK_MASTER_KEY when no versioned KEKs are found", () => {
      const vault = createKeyVaultFromEnv({
        BYOK_MASTER_KEY: KEK_V1
      });
      expect(vault.getCurrentVersion()).toBe(1);
      expect(vault.hasVersion(1)).toBe(true);
    });

    it("provides default test KEK when env is completely empty", () => {
      const vault = createKeyVaultFromEnv({});
      expect(vault.getCurrentVersion()).toBe(1);
      expect(vault.hasVersion(1)).toBe(true);
    });
  });

  it("buildBYOKAdditionalData produces expected deterministic format", () => {
    const aad = buildBYOKAdditionalData("usr_123", "openai", 1);
    const decoded = new TextDecoder().decode(aad);
    expect(decoded).toBe("usr_123|openai|v1");
  });
});
