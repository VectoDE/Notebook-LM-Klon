export interface CryptoBenchmarkResult {
  readonly sha256AvgMs: number;
  readonly aesGcmRoundtripAvgMs: number;
  readonly ecdsaVerifyAvgMs: number;
  readonly totalCombinedMs: number;
  readonly withinFreeTierBudget: boolean;
}

/**
 * Benchmarks native WebCrypto operations used per Worker request:
 * 1. SHA-256 hashing (session cookies, magic links, IP privacy hashing)
 * 2. AES-256-GCM envelope encryption & decryption with AAD (BYOK provider keys)
 * 3. ECDSA P-256 SHA-256 signature verification (WebAuthn Passkey assertion verification)
 */
export async function runWorkerCryptoBenchmark(iterations = 25): Promise<CryptoBenchmarkResult> {
  const encoder = new TextEncoder();
  const sampleToken = encoder.encode("session-token-sample-payload-for-sha256-benchmark");

  // Warmup WebCrypto engine to avoid one-time OpenSSL/V8 lazy initialization jitter
  await crypto.subtle.digest("SHA-256", sampleToken);

  // 1. SHA-256 benchmark
  const shaStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    await crypto.subtle.digest("SHA-256", sampleToken);
  }
  const sha256AvgMs = (performance.now() - shaStart) / iterations;

  // 2. AES-256-GCM roundtrip benchmark (with AAD)
  const rawKek = crypto.getRandomValues(new Uint8Array(32));
  const kek = await crypto.subtle.importKey("raw", rawKek, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt"
  ]);
  const aad = encoder.encode("user_01J9XYZ|gemini|v1");
  const plaintextKey = encoder.encode("AIzaSyDummyGeminiApiKeyForBenchmarkingPurposesOnly123");
  const warmupIv = crypto.getRandomValues(new Uint8Array(12));
  const warmupCt = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: warmupIv, additionalData: aad },
    kek,
    plaintextKey
  );
  await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: warmupIv, additionalData: aad },
    kek,
    warmupCt
  );

  const aesStart = performance.now();
  const reusableIv = crypto.getRandomValues(new Uint8Array(12));
  for (let i = 0; i < iterations; i++) {
    reusableIv[11] = i & 0xff;
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: reusableIv, additionalData: aad },
      kek,
      plaintextKey
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: reusableIv, additionalData: aad },
      kek,
      ciphertext
    );
    void decrypted.byteLength;
  }
  const aesGcmRoundtripAvgMs = (performance.now() - aesStart) / iterations;

  // 3. ECDSA P-256 signature verification benchmark (WebAuthn Passkey ES256)
  const keyPair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify"
  ])) as CryptoKeyPair;
  const authenticatorDataAndClientHash = crypto.getRandomValues(new Uint8Array(69));
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    authenticatorDataAndClientHash
  );
  await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.publicKey,
    signature,
    authenticatorDataAndClientHash
  );

  const ecdsaStart = performance.now();
  let allSignaturesValid = true;
  for (let i = 0; i < iterations; i++) {
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.publicKey,
      signature,
      authenticatorDataAndClientHash
    );
    allSignaturesValid = allSignaturesValid && valid;
  }
  const ecdsaVerifyAvgMs = (performance.now() - ecdsaStart) / iterations;

  const totalCombinedMs = sha256AvgMs + aesGcmRoundtripAvgMs + ecdsaVerifyAvgMs;

  return {
    sha256AvgMs,
    aesGcmRoundtripAvgMs,
    ecdsaVerifyAvgMs,
    totalCombinedMs,
    // Cloudflare Workers Free limit is 10 ms CPU/invocation; per-op budget is safely within 10ms
    withinFreeTierBudget:
      allSignaturesValid &&
      sha256AvgMs < 5 &&
      aesGcmRoundtripAvgMs < 5 &&
      ecdsaVerifyAvgMs < 5 &&
      totalCombinedMs < 10
  };
}
