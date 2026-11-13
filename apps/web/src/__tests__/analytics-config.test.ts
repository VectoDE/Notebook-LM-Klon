import { describe, expect, it } from "vitest";
import { readGtmId, readSiteVerification } from "../analytics-config.js";

describe("Konfiguration der Messung nur per Umgebungsvariable (Issues #260, #261)", () => {
  it("akzeptiert nur gültige GTM-Container-IDs", () => {
    expect(readGtmId("GTM-ABC1234")).toBe("GTM-ABC1234");
    expect(readGtmId("  GTM-ABC1234 ")).toBe("GTM-ABC1234");
    for (const bad of [undefined, "", "G-ABC1234", "GTM-abc", "GTM-AB", 'GTM-ABC1234"><script>']) {
      expect(readGtmId(bad), String(bad)).toBeNull();
    }
  });

  it("akzeptiert nur gültige Search-Console-Token", () => {
    expect(readSiteVerification("abcDEF123_-xyz")).toBe("abcDEF123_-xyz");
    for (const bad of [undefined, "", "kurz", 'abc"><meta name="x', "a".repeat(101)]) {
      expect(readSiteVerification(bad), String(bad)).toBeNull();
    }
  });
});
