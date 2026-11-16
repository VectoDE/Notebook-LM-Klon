import { describe, expect, it } from "vitest";
import {
  LAYOUT_STORAGE_KEYS,
  NOTEBOOK_TITLE_MAX_LENGTH,
  NO_PANELS_COLLAPSED,
  PANEL_SHORTCUTS,
  defaultCollapsedPanels,
  matchPanelShortcut,
  normalizeNotebookTitle,
  readChatId,
  readCollapsedPanels,
  readNotebookTitle,
  storeChatId,
  storeCollapsedPanels,
  storeNotebookTitle
} from "../layout-preferences.js";

/** Einfacher Speicher im Arbeitsspeicher, wie localStorage. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    }
  };
}

const failing = {
  getItem: (): string | null => {
    throw new Error("gesperrt");
  },
  setItem: (): void => {
    throw new Error("voll");
  }
};

const key = (code: string, extra: Partial<Parameters<typeof matchPanelShortcut>[0]> = {}) => ({
  code,
  altKey: true,
  shiftKey: true,
  ctrlKey: false,
  metaKey: false,
  ...extra
});

describe("Tastenkürzel der Spalten (Issue #325)", () => {
  it("Alt+Umschalt+1 und +3 schalten Quellen und Studio um, auch auf dem Ziffernblock", () => {
    expect(matchPanelShortcut(key("Digit1"))).toBe("sources");
    expect(matchPanelShortcut(key("Numpad1"))).toBe("sources");
    expect(matchPanelShortcut(key("Digit3"))).toBe("studio");
    expect(matchPanelShortcut(key("Numpad3"))).toBe("studio");
    expect(PANEL_SHORTCUTS).toEqual({ sources: "Alt+Shift+1", studio: "Alt+Shift+3" });
  });

  it("andere Tasten, fehlende oder zusätzliche Umschalter und Wiederholung zählen nicht", () => {
    expect(matchPanelShortcut(key("Digit2"))).toBeNull();
    expect(matchPanelShortcut(key("Digit1", { altKey: false }))).toBeNull();
    expect(matchPanelShortcut(key("Digit1", { shiftKey: false }))).toBeNull();
    expect(matchPanelShortcut(key("Digit1", { ctrlKey: true }))).toBeNull();
    expect(matchPanelShortcut(key("Digit1", { metaKey: true }))).toBeNull();
    expect(matchPanelShortcut(key("Digit1", { repeat: true }))).toBeNull();
  });
});

describe("Eingeklappte Spalten speichern", () => {
  it("liest gespeicherte Werte und fällt sonst auf ausgeklappt zurück", () => {
    expect(readCollapsedPanels(undefined)).toEqual(NO_PANELS_COLLAPSED);
    expect(readCollapsedPanels(memoryStorage())).toEqual(NO_PANELS_COLLAPSED);
    expect(readCollapsedPanels(failing)).toEqual(NO_PANELS_COLLAPSED);
    for (const raw of ["kaputt{", "[true]", "null", "42"]) {
      expect(
        readCollapsedPanels(memoryStorage({ [LAYOUT_STORAGE_KEYS.collapsed]: raw })),
        raw
      ).toEqual(NO_PANELS_COLLAPSED);
    }
    const stored = memoryStorage({
      [LAYOUT_STORAGE_KEYS.collapsed]: JSON.stringify({ sources: true, studio: "ja" })
    });
    expect(readCollapsedPanels(stored)).toEqual({ sources: true, studio: false });
  });

  it("klappt ohne gespeicherte Wahl das Studio auf schmalem Desktop ein (Issue #335)", () => {
    expect(defaultCollapsedPanels(undefined)).toEqual(NO_PANELS_COLLAPSED);
    for (const width of [390, 899, 1280, 1440]) {
      expect(defaultCollapsedPanels(width), String(width)).toEqual(NO_PANELS_COLLAPSED);
    }
    for (const width of [900, 1024, 1279]) {
      expect(defaultCollapsedPanels(width), String(width)).toEqual({
        sources: false,
        studio: true
      });
    }
    expect(readCollapsedPanels(memoryStorage(), 1024)).toEqual({ sources: false, studio: true });
    expect(readCollapsedPanels(failing, 1024)).toEqual({ sources: false, studio: true });
    expect(readCollapsedPanels(memoryStorage(), 1440)).toEqual(NO_PANELS_COLLAPSED);
    // Eine gespeicherte Wahl gilt immer, auch auf 1024 px
    const stored = memoryStorage({
      [LAYOUT_STORAGE_KEYS.collapsed]: JSON.stringify({ sources: false, studio: false })
    });
    expect(readCollapsedPanels(stored, 1024)).toEqual(NO_PANELS_COLLAPSED);
    const broken = memoryStorage({ [LAYOUT_STORAGE_KEYS.collapsed]: "kaputt{" });
    expect(readCollapsedPanels(broken, 1024)).toEqual(NO_PANELS_COLLAPSED);
  });

  it("schreibt nur die beiden Spalten und ignoriert Speicherfehler", () => {
    const storage = memoryStorage();
    storeCollapsedPanels(storage, { sources: false, studio: true });
    expect(storage.data.get(LAYOUT_STORAGE_KEYS.collapsed)).toBe('{"sources":false,"studio":true}');
    expect(readCollapsedPanels(storage)).toEqual({ sources: false, studio: true });
    expect(() => storeCollapsedPanels(failing, NO_PANELS_COLLAPSED)).not.toThrow();
    expect(() => storeCollapsedPanels(undefined, NO_PANELS_COLLAPSED)).not.toThrow();
  });
});

describe("Notebook-Titel", () => {
  it("fasst Leerraum zusammen, kürzt lange Titel und behält bei leerer Eingabe den alten", () => {
    expect(normalizeNotebookTitle("  Neuer   Titel \n", "Alt")).toBe("Neuer Titel");
    expect(normalizeNotebookTitle("   ", "Alt")).toBe("Alt");
    const long = `${"a".repeat(NOTEBOOK_TITLE_MAX_LENGTH - 1)} bcd`;
    expect(normalizeNotebookTitle(long, "Alt")).toBe("a".repeat(NOTEBOOK_TITLE_MAX_LENGTH - 1));
  });

  it("speichert je Notebook und liest mit Rückfall", () => {
    const storage = memoryStorage();
    expect(readNotebookTitle(storage, "nb_1", "Standard")).toBe("Standard");
    storeNotebookTitle(storage, "nb_1", "Erstes");
    storeNotebookTitle(storage, "nb_2", "Zweites");
    expect(readNotebookTitle(storage, "nb_1", "Standard")).toBe("Erstes");
    expect(readNotebookTitle(storage, "nb_2", "Standard")).toBe("Zweites");
    const odd = memoryStorage({
      [LAYOUT_STORAGE_KEYS.titles]: JSON.stringify({ nb_1: 7, nb_2: "   " })
    });
    expect(readNotebookTitle(odd, "nb_1", "Standard")).toBe("Standard");
    expect(readNotebookTitle(odd, "nb_2", "Standard")).toBe("Standard");
    expect(readNotebookTitle(failing, "nb_1", "Standard")).toBe("Standard");
    expect(readNotebookTitle(undefined, "nb_1", "Standard")).toBe("Standard");
    expect(() => storeNotebookTitle(failing, "nb_1", "x")).not.toThrow();
  });

  it("merkt sich die Chat-Kennung je Notebook (Verlauf nach dem Neuladen, Issue #243)", () => {
    const storage = memoryStorage();
    expect(readChatId(storage, "nb_1")).toBeUndefined();
    storeChatId(storage, "nb_1", "chat_a");
    storeChatId(storage, "nb_2", "chat_b");
    expect(readChatId(storage, "nb_1")).toBe("chat_a");
    expect(readChatId(storage, "nb_2")).toBe("chat_b");
    const odd = memoryStorage({
      [LAYOUT_STORAGE_KEYS.chats]: JSON.stringify({ nb_1: 7, nb_2: "" })
    });
    expect(readChatId(odd, "nb_1")).toBeUndefined();
    expect(readChatId(odd, "nb_2")).toBeUndefined();
    expect(readChatId(failing, "nb_1")).toBeUndefined();
    expect(readChatId(undefined, "nb_1")).toBeUndefined();
    expect(() => storeChatId(failing, "nb_1", "x")).not.toThrow();
  });
});
