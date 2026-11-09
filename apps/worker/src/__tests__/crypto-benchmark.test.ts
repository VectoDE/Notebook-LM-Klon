import { describe, expect, it } from "vitest";
import { runWorkerCryptoBenchmark } from "../crypto-benchmark.js";

describe("Cloudflare Worker 10ms CPU Budget – WebCrypto Benchmark", () => {
  it("executes SHA-256, AES-256-GCM envelope roundtrip, and WebAuthn ECDSA P-256 verify in < 5ms each and < 10ms combined", async () => {
    const result = await runWorkerCryptoBenchmark();

    expect(result.sha256AvgMs).toBeLessThan(5);
    expect(result.aesGcmRoundtripAvgMs).toBeLessThan(5);
    expect(result.ecdsaVerifyAvgMs).toBeLessThan(5);
    expect(result.totalCombinedMs).toBeLessThan(10);
    expect(result.withinFreeTierBudget).toBe(true);
  });
});
