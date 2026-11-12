import { describe, expect, it, vi } from "vitest";
import { FOCUSABLE_SELECTOR, nextTrapIndex, tabbableItems, trapTabKey } from "../focus-trap.js";

const makeItems = (n: number) => Array.from({ length: n }, () => ({ focus: vi.fn() }));
const container = (items: { focus: () => void }[]) => ({
  querySelectorAll: (selector: string) => {
    expect(selector).toBe(FOCUSABLE_SELECTOR);
    return items;
  }
});
const keyEvent = (key: string, shiftKey = false) => ({ key, shiftKey, preventDefault: vi.fn() });

describe("nextTrapIndex", () => {
  it("lässt den Browser innerhalb der Liste normal springen", () => {
    expect(nextTrapIndex(3, 0, false)).toBeNull();
    expect(nextTrapIndex(3, 2, true)).toBeNull();
  });
  it("springt vom letzten zum ersten und umgekehrt", () => {
    expect(nextTrapIndex(3, 2, false)).toBe(0);
    expect(nextTrapIndex(3, 0, true)).toBe(2);
  });
  it("holt einen Fokus von außerhalb in den Container", () => {
    expect(nextTrapIndex(3, -1, false)).toBe(0);
    expect(nextTrapIndex(3, -1, true)).toBe(2);
  });
  it("ohne Elemente gibt es kein Ziel", () => {
    expect(nextTrapIndex(0, -1, false)).toBeNull();
  });
});

describe("trapTabKey", () => {
  it("ignoriert andere Tasten", () => {
    const ev = keyEvent("Enter");
    expect(trapTabKey(ev, container(makeItems(2)), null)).toBe(false);
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });
  it("lenkt vom letzten Element auf das erste um", () => {
    const items = makeItems(3);
    const ev = keyEvent("Tab");
    expect(trapTabKey(ev, container(items), items[2])).toBe(true);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(items[0]?.focus).toHaveBeenCalled();
  });
  it("lenkt mit Umschalt vom ersten auf das letzte um", () => {
    const items = makeItems(3);
    const ev = keyEvent("Tab", true);
    expect(trapTabKey(ev, container(items), items[0])).toBe(true);
    expect(items[2]?.focus).toHaveBeenCalled();
  });
  it("lässt Tab in der Mitte durch", () => {
    const items = makeItems(3);
    const ev = keyEvent("Tab");
    expect(trapTabKey(ev, container(items), items[1])).toBe(false);
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });
  it("unterdrückt Tab, wenn nichts fokussierbar ist", () => {
    const ev = keyEvent("Tab");
    expect(trapTabKey(ev, container([]), null)).toBe(true);
    expect(ev.preventDefault).toHaveBeenCalled();
  });
});

describe("tabbableItems", () => {
  const radio = (name: string, checked: boolean) => ({
    type: "radio",
    name,
    checked,
    focus: vi.fn()
  });
  it("behält pro Radiogruppe nur den gewählten Knopf", () => {
    const button = { focus: vi.fn() };
    const a1 = radio("a", false);
    const a2 = radio("a", true);
    const b1 = radio("b", false);
    const b2 = radio("b", false);
    const lone = { type: "radio", focus: vi.fn() };
    expect(tabbableItems([button, a1, a2, b1, b2, lone])).toEqual([button, a2, b1, lone]);
  });
  it("springt vom gewählten Knopf der letzten Gruppe zurück zum Anfang", () => {
    const first = { focus: vi.fn() };
    const r1 = radio("m", true);
    const r2 = radio("m", false);
    const ev = keyEvent("Tab");
    expect(trapTabKey(ev, container([first, r1, r2]), r1)).toBe(true);
    expect(first.focus).toHaveBeenCalled();
  });
});
