import { describe, expect, it, vi } from "vitest";
import {
  COLOR_MODE_PREFERENCES,
  DEFAULT_MODEL,
  LANGUAGES,
  MODEL_IDS,
  REDUCED_MOTION_QUERY,
  REDUCE_MOTION_ATTRIBUTE,
  STORAGE_KEYS,
  SYSTEM_COLOR_QUERIES,
  applyReduceMotion,
  applyThemeToDocument,
  browserStorage,
  readReduceMotion,
  readStoredModel,
  resolveColorMode,
  resolveInitialPreferences,
  shouldReduceMotion,
  storeModel,
  systemColorMode,
  systemPrefersReducedMotion
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
  it("nutzt ohne Speicher Pure, Automatisch (wie Gerät) und Deutsch (Issue #328)", () => {
    expect(resolveInitialPreferences({})).toEqual({
      theme: "pure",
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
      theme: "pure",
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
    expect(root.setAttribute).toHaveBeenCalledWith("lang", "en");
    expect(root.setAttribute).toHaveBeenLastCalledWith("dir", "ltr");
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
    expect(root.setAttribute).toHaveBeenCalledTimes(8);
  });
});

describe("Bewegung reduzieren (Issue #315)", () => {
  it('liest nur "true" als eingeschaltet', () => {
    expect(STORAGE_KEYS.reduceMotion).toBe("rn_reduce_motion");
    expect(readReduceMotion(storage({ rn_reduce_motion: "true" }))).toBe(true);
    expect(readReduceMotion(storage({ rn_reduce_motion: "false" }))).toBe(false);
    expect(readReduceMotion(storage({}))).toBe(false);
    expect(readReduceMotion(undefined)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      }
    };
    expect(readReduceMotion(broken)).toBe(false);
  });

  it("setzt bzw. entfernt das Attribut und speichert die Wahl", () => {
    const root = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
    const store = { setItem: vi.fn() };
    applyReduceMotion(root, true, store);
    expect(root.setAttribute).toHaveBeenCalledWith(REDUCE_MOTION_ATTRIBUTE, "true");
    expect(store.setItem).toHaveBeenLastCalledWith("rn_reduce_motion", "true");
    applyReduceMotion(root, false, store);
    expect(root.removeAttribute).toHaveBeenCalledWith(REDUCE_MOTION_ATTRIBUTE);
    expect(store.setItem).toHaveBeenLastCalledWith("rn_reduce_motion", "false");
  });

  it("arbeitet ohne Speicher und bei Speicherfehlern weiter", () => {
    const root = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
    expect(() => applyReduceMotion(root, true)).not.toThrow();
    const failing = {
      setItem: () => {
        throw new Error("QuotaExceededError");
      }
    };
    expect(() => applyReduceMotion(root, false, failing)).not.toThrow();
  });

  it("folgt dem Schalter in der App oder der Geräteeinstellung", () => {
    const on = { getAttribute: () => "true" };
    const off = { getAttribute: () => null };
    expect(shouldReduceMotion(on)).toBe(true);
    expect(shouldReduceMotion(off)).toBe(false);
    expect(shouldReduceMotion(undefined)).toBe(false);
    expect(shouldReduceMotion(off, media({ [REDUCED_MOTION_QUERY]: true }))).toBe(true);
    expect(shouldReduceMotion(off, media({}))).toBe(false);
  });

  it("liest den Systemwert für den Hinweis am Schalter (Issue #328)", () => {
    expect(systemPrefersReducedMotion(media({ [REDUCED_MOTION_QUERY]: true }))).toBe(true);
    expect(systemPrefersReducedMotion(media({}))).toBe(false);
    expect(systemPrefersReducedMotion(undefined)).toBe(false);
  });
});

describe("Modellwahl (Issue #319)", () => {
  it("liest nur bekannte Modelle, sonst den Standard", () => {
    expect(STORAGE_KEYS.model).toBe("rn_model");
    expect(DEFAULT_MODEL).toBe("gemini-2.5-flash");
    expect(MODEL_IDS).toContain("gpt-4o");
    expect(readStoredModel(storage({ rn_model: "gpt-4o" }))).toBe("gpt-4o");
    expect(readStoredModel(storage({ rn_model: "gpt-9-evil" }))).toBe(DEFAULT_MODEL);
    expect(readStoredModel(storage({}))).toBe(DEFAULT_MODEL);
    expect(readStoredModel(undefined)).toBe(DEFAULT_MODEL);
    const failing = {
      getItem: () => {
        throw new Error("SecurityError");
      }
    };
    expect(readStoredModel(failing)).toBe(DEFAULT_MODEL);
  });

  it("speichert nur bekannte Modelle und übersteht Speicherfehler", () => {
    const store = { setItem: vi.fn() };
    storeModel(store, "deepseek-r1");
    expect(store.setItem).toHaveBeenCalledWith("rn_model", "deepseek-r1");
    storeModel(store, "unbekannt");
    expect(store.setItem).toHaveBeenCalledTimes(1);
    expect(() => storeModel(undefined, "gpt-4o")).not.toThrow();
    const failing = {
      setItem: () => {
        throw new Error("QuotaExceededError");
      }
    };
    expect(() => storeModel(failing, "gpt-4o")).not.toThrow();
  });

  it("findet den Browserspeicher, wenn es ihn gibt", () => {
    expect(browserStorage()).toBeUndefined();
    const fake = { getItem: () => null } as unknown as Storage;
    vi.stubGlobal("window", { localStorage: fake });
    expect(browserStorage()).toBe(fake);
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("SecurityError");
      }
    });
    expect(browserStorage()).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
