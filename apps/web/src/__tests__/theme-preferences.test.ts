import { describe, expect, it, vi } from "vitest";
import {
  COLOR_MODE_PREFERENCES,
  LANGUAGES,
  STORAGE_KEYS,
  SYSTEM_COLOR_QUERIES,
  applyThemeToDocument,
  resolveColorMode,
  resolveInitialPreferences,
  systemColorMode
} from "../theme-preferences.js";

function storage(values: Record<string, string>) {
  return { getItem: (key: string) => values[key] ?? null };
}

function media(matches: Record<string, boolean>) {
  return (query: string) => ({ matches: matches[query] ?? false });
}

describe("systemColorMode", () => {
  it("folgt prefers-contrast vor prefers-color-scheme", () => {
    expect(systemColorMode({})).toBe("light");
    expect(systemColorMode({ matchMedia: media({}) })).toBe("light");
    expect(systemColorMode({ matchMedia: media({ "(prefers-color-scheme: dark)": true }) })).toBe(
      "dark"
    );
    expect(
      systemColorMode({
        matchMedia: media({
          "(prefers-color-scheme: dark)": true,
          "(prefers-contrast: more)": true
        })
      })
    ).toBe("aaa-contrast");
  });
});

describe("resolveColorMode", () => {
  it("löst Automatisch über den Gerätemodus auf und lässt feste Wahl unverändert", () => {
    expect(COLOR_MODE_PREFERENCES).toEqual(["system", "light", "dark", "aaa-contrast"]);
    expect(SYSTEM_COLOR_QUERIES).toEqual([
      "(prefers-contrast: more)",
      "(prefers-color-scheme: dark)"
    ]);
    expect(resolveColorMode("system", "dark")).toBe("dark");
    expect(resolveColorMode("system", "aaa-contrast")).toBe("aaa-contrast");
    expect(resolveColorMode("light", "dark")).toBe("light");
    expect(resolveColorMode("aaa-contrast", "light")).toBe("aaa-contrast");
  });
});

describe("resolveInitialPreferences", () => {
  it("nutzt ohne Speicher Fusion, Automatisch (wie Gerät) und Deutsch", () => {
    expect(resolveInitialPreferences({})).toEqual({
      theme: "fusion",
      colorMode: "system",
      language: "de"
    });
    expect(
      resolveInitialPreferences({ matchMedia: media({ "(prefers-color-scheme: dark)": true }) })
    ).toMatchObject({ colorMode: "system" });
  });

  it("liest die gespeicherte Wahl Automatisch", () => {
    const prefs = resolveInitialPreferences(
      { storage: storage({ [STORAGE_KEYS.colorMode]: "system" }) },
      { colorMode: "dark" }
    );
    expect(prefs.colorMode).toBe("system");
  });

  it("bevorzugt gespeicherte Werte vor Standardwerten", () => {
    const prefs = resolveInitialPreferences(
      {
        storage: storage({
          [STORAGE_KEYS.theme]: "editorial-calm",
          [STORAGE_KEYS.colorMode]: "aaa-contrast",
          [STORAGE_KEYS.language]: "en"
        })
      },
      { theme: "pure", colorMode: "dark", language: "de" }
    );
    expect(prefs).toEqual({ theme: "editorial-calm", colorMode: "aaa-contrast", language: "en" });
  });

  it("nimmt übergebene Standardwerte, wenn nichts Gültiges gespeichert ist", () => {
    const prefs = resolveInitialPreferences(
      { storage: storage({ [STORAGE_KEYS.theme]: "unbekannt", [STORAGE_KEYS.language]: "fr" }) },
      { theme: "immersive-cinema", colorMode: "dark", language: "en" }
    );
    expect(prefs).toEqual({ theme: "immersive-cinema", colorMode: "dark", language: "en" });
  });

  it("übernimmt alte Werte vor Issue #252 (rn_theme, pure-notebooklm, oled-dark)", () => {
    const prefs = resolveInitialPreferences({
      storage: storage({ rn_theme: "pure-notebooklm", [STORAGE_KEYS.colorMode]: "oled-dark" })
    });
    expect(prefs).toMatchObject({ theme: "pure", colorMode: "dark" });
  });

  it("verkraftet einen Speicher, der beim Lesen wirft", () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      }
    };
    expect(resolveInitialPreferences({ storage: throwing })).toEqual({
      theme: "fusion",
      colorMode: "system",
      language: "de"
    });
  });

  it("kennt genau Deutsch und Englisch", () => {
    expect(LANGUAGES).toEqual(["de", "en"]);
  });
});

describe("applyThemeToDocument", () => {
  const prefs = { theme: "fusion", colorMode: "dark", language: "en" } as const;

  it("setzt data-design, data-color-mode und lang und entfernt data-theme", () => {
    const root = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
    const store = { setItem: vi.fn() };
    applyThemeToDocument(root, prefs, store);
    expect(root.setAttribute).toHaveBeenCalledWith("data-design", "fusion");
    expect(root.setAttribute).toHaveBeenCalledWith("data-color-mode", "dark");
    expect(root.setAttribute).toHaveBeenCalledWith("lang", "en");
    expect(root.setAttribute).not.toHaveBeenCalledWith("data-theme", expect.anything());
    expect(root.removeAttribute).toHaveBeenCalledWith("data-theme");
    expect(store.setItem).toHaveBeenCalledWith(STORAGE_KEYS.theme, "fusion");
    expect(store.setItem).toHaveBeenCalledWith(STORAGE_KEYS.colorMode, "dark");
    expect(store.setItem).toHaveBeenCalledWith(STORAGE_KEYS.language, "en");
  });

  it("setzt bei Automatisch den Gerätemodus und speichert die Wahl", () => {
    const root = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
    const store = { setItem: vi.fn() };
    applyThemeToDocument(root, { ...prefs, colorMode: "system" }, store, "aaa-contrast");
    expect(root.setAttribute).toHaveBeenCalledWith("data-color-mode", "aaa-contrast");
    expect(store.setItem).toHaveBeenCalledWith(STORAGE_KEYS.colorMode, "system");
    applyThemeToDocument(root, { ...prefs, colorMode: "system" });
    expect(root.setAttribute).toHaveBeenLastCalledWith("lang", "en");
    expect(root.setAttribute).toHaveBeenCalledWith("data-color-mode", "light");
  });

  it("arbeitet ohne Speicher und bei Speicherfehlern weiter", () => {
    const root = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
    expect(() => applyThemeToDocument(root, prefs)).not.toThrow();
    const failing = {
      setItem: () => {
        throw new Error("QuotaExceededError");
      }
    };
    expect(() => applyThemeToDocument(root, prefs, failing)).not.toThrow();
    expect(root.setAttribute).toHaveBeenCalledTimes(6);
  });
});
