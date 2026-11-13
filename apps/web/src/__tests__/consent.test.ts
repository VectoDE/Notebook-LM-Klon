import { describe, expect, it } from "vitest";
import {
  CONSENT_STORAGE_KEY,
  CONSENT_VERSION,
  analyticsAllowed,
  clearConsent,
  needsConsentDecision,
  readConsent,
  storeConsent
} from "../consent.js";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    }
  };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("quota");
  },
  removeItem: () => {
    throw new Error("blocked");
  }
};

describe("Einwilligung speichern und lesen (Issue #261)", () => {
  it("speichert die Entscheidungen und liest sie wieder", () => {
    const storage = memoryStorage();
    const now = new Date("2026-11-13T10:00:00Z");

    const all = storeConsent(storage, true, now);
    expect(all).toEqual({
      version: CONSENT_VERSION,
      analytics: true,
      decidedAt: now.toISOString()
    });
    expect(readConsent(storage)).toEqual(all);
    expect(analyticsAllowed(readConsent(storage))).toBe(true);

    const necessary = storeConsent(storage, false, now);
    expect(readConsent(storage)).toEqual(necessary);
    expect(analyticsAllowed(readConsent(storage))).toBe(false);

    clearConsent(storage);
    expect(readConsent(storage)).toBeNull();
    expect(storage.data.has(CONSENT_STORAGE_KEY)).toBe(false);
  });

  it("verlangt eine Entscheidung nur, wenn ein optionaler Dienst eingerichtet ist", () => {
    const decided = storeConsent(undefined, false);
    expect(needsConsentDecision(null, true)).toBe(true);
    expect(needsConsentDecision(decided, true)).toBe(false);
    expect(needsConsentDecision(null, false)).toBe(false);
    expect(analyticsAllowed(null)).toBe(false);
    expect(decided.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("verwirft ungültige, fremde oder veraltete Einträge", () => {
    for (const raw of [
      "kein json",
      "null",
      JSON.stringify({ version: CONSENT_VERSION + 1, analytics: true, decidedAt: "x" }),
      JSON.stringify({ version: CONSENT_VERSION, analytics: "ja", decidedAt: "x" }),
      JSON.stringify({ version: CONSENT_VERSION, analytics: true })
    ]) {
      expect(readConsent(memoryStorage({ [CONSENT_STORAGE_KEY]: raw })), raw).toBeNull();
    }
    expect(readConsent(memoryStorage())).toBeNull();
    expect(readConsent(undefined)).toBeNull();
  });

  it("übersteht gesperrten Speicher ohne Fehler", () => {
    expect(readConsent(throwing)).toBeNull();
    expect(storeConsent(throwing, true).analytics).toBe(true);
    expect(() => clearConsent(throwing)).not.toThrow();
    expect(() => clearConsent(undefined)).not.toThrow();
  });
});
