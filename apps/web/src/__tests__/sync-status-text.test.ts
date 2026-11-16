import { describe, expect, it } from "vitest";
import { fill } from "../i18n.js";
import { describeSyncStatus } from "../sync-status-text.js";
import { AREA_DE, AREA_EN } from "../translations-areas.js";

describe("describeSyncStatus (Issue #347)", () => {
  for (const language of ["de", "en"] as const) {
    const catalog = language === "de" ? AREA_DE : AREA_EN;
    const tf = (key: string, vars: Readonly<Record<string, string | number>>) =>
      fill(catalog[key] ?? key, vars);
    it(`liefert für jeden Stand einen Text (${language})`, () => {
      const texts = [
        describeSyncStatus({ state: "syncing", pending: 0 }, tf),
        describeSyncStatus({ state: "synced", pending: 0 }, tf),
        describeSyncStatus({ state: "pending", pending: 1 }, tf),
        describeSyncStatus({ state: "pending", pending: 3 }, tf),
        describeSyncStatus({ state: "offline", pending: 0 }, tf),
        describeSyncStatus({ state: "offline", pending: 1 }, tf),
        describeSyncStatus({ state: "offline", pending: 2 }, tf),
        describeSyncStatus({ state: "error", pending: 0 }, tf),
        describeSyncStatus({ state: "error", pending: 1 }, tf),
        describeSyncStatus({ state: "error", pending: 4 }, tf)
      ];
      expect(new Set(texts).size).toBe(texts.length);
      for (const text of texts) expect(text).not.toMatch(/sync[A-Z]|\{n\}/);
      expect(texts[3]).toContain("3");
      expect(texts[6]).toContain("2");
    });
  }
});
