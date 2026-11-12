import { describe, expect, it } from "vitest";
import { type FocusCandidate, focusFirstAvailable } from "../focus-return.js";

/** Nachbau eines Elements: nimmt den Fokus nur an, wenn es fokussierbar ist. */
function element(focusable: boolean, isConnected?: boolean) {
  const state = { active: null as unknown };
  const calls: unknown[] = [];
  const make = (): FocusCandidate & { calls: unknown[] } => {
    const el: FocusCandidate & { calls: unknown[] } = {
      calls,
      focus(options) {
        calls.push(options);
        if (focusable) state.active = el;
      },
      ...(isConnected === undefined ? {} : { isConnected })
    };
    return el;
  };
  return { el: make(), state };
}

describe("focusFirstAvailable (Fokus-Rückgabe, #294)", () => {
  it("fokussiert den gemerkten Auslöser, wenn er den Fokus annimmt", () => {
    const shared = { active: null as unknown };
    const trigger: FocusCandidate = {
      focus: () => {
        shared.active = trigger;
      },
      isConnected: true
    };
    const fallback: FocusCandidate = {
      focus: () => {
        shared.active = fallback;
      }
    };
    expect(focusFirstAvailable([trigger, fallback], () => shared.active)).toBe(trigger);
    expect(shared.active).toBe(trigger);
  });

  it("überspringt ausgehängte Elemente ohne focus() aufzurufen", () => {
    const gone = element(true, false);
    const shared = { active: null as unknown };
    const fallback: FocusCandidate = {
      focus: () => {
        shared.active = fallback;
      }
    };
    expect(focusFirstAvailable([gone.el, fallback], () => shared.active)).toBe(fallback);
    expect(gone.el.calls).toEqual([]);
  });

  it("geht weiter, wenn ein Element im DOM hängt, den Fokus aber nicht annimmt (geschlossenes Sheet)", () => {
    const hidden = element(false, true);
    const shared = { active: null as unknown };
    const menuButton: FocusCandidate = {
      focus: () => {
        shared.active = menuButton;
      }
    };
    expect(focusFirstAvailable([hidden.el, menuButton], () => shared.active)).toBe(menuButton);
    expect(hidden.el.calls).toEqual([{ preventScroll: true }]);
  });

  it("ignoriert leere Kandidaten und liefert null, wenn keiner den Fokus annimmt", () => {
    const hidden = element(false);
    expect(focusFirstAvailable([null, undefined, hidden.el], () => hidden.state.active)).toBeNull();
    expect(focusFirstAvailable([], () => null)).toBeNull();
  });
});
