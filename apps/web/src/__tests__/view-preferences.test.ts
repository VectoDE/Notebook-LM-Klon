import { describe, expect, it } from "vitest";
import {
  VIEW_STORAGE_KEYS,
  readSourcesView,
  readTableView,
  storeView
} from "../view-preferences.js";

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

describe("Gespeicherte Ansichten (Issue #329)", () => {
  it("Quellen: Liste ist Standard, Karten werden gelesen", () => {
    expect(readSourcesView(undefined)).toBe("list");
    expect(readSourcesView(memoryStorage())).toBe("list");
    expect(readSourcesView(memoryStorage({ [VIEW_STORAGE_KEYS.sources]: "cards" }))).toBe("cards");
    expect(readSourcesView(memoryStorage({ [VIEW_STORAGE_KEYS.sources]: "kaputt" }))).toBe("list");
    expect(readSourcesView(failing)).toBe("list");
  });

  it("Tabelle: gespeicherte Wahl gewinnt, sonst der Rückfall", () => {
    const key = VIEW_STORAGE_KEYS.quizResults;
    expect(readTableView(undefined, key, "table")).toBe("table");
    expect(readTableView(memoryStorage(), key, "cards")).toBe("cards");
    expect(readTableView(memoryStorage({ [key]: "table" }), key, "cards")).toBe("table");
    expect(readTableView(memoryStorage({ [key]: "cards" }), key, "table")).toBe("cards");
    expect(readTableView(memoryStorage({ [key]: "liste" }), key, "table")).toBe("table");
    expect(readTableView(failing, key, "cards")).toBe("cards");
  });

  it("Speichern schreibt den Wert und übersteht gesperrten Speicher", () => {
    const storage = memoryStorage();
    storeView(storage, VIEW_STORAGE_KEYS.sources, "cards");
    expect(storage.data.get("rn_sources_view")).toBe("cards");
    expect(() => storeView(failing, VIEW_STORAGE_KEYS.sources, "list")).not.toThrow();
    expect(() => storeView(undefined, VIEW_STORAGE_KEYS.sources, "list")).not.toThrow();
  });
});
