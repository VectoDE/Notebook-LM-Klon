import { describe, expect, it } from "vitest";
import { runWorkerCryptoBenchmark } from "../crypto-benchmark.js";

describe("Cloudflare Worker 10ms CPU Budget – WebCrypto Benchmark", () => {
  it("executes SHA-256, AES-256-GCM envelope roundtrip, and WebAuthn ECDSA P-256 verify in < 2ms each", async () => {
    const result = await runWorkerCryptoBenchmark(30);

    expect(result.sha256AvgMs).toBeLessThan(2);
    expect(result.aesGcmRoundtripAvgMs).toBeLessThan(2);
    expect(result.ecdsaVerifyAvgMs).toBeLessThan(2);
    expect(result.totalCombinedMs).toBeLessThan(5);
    expect(result.withinFreeTierBudget).toBe(true);
  });
});
