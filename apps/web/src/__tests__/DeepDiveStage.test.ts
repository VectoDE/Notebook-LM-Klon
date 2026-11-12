import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DeepDiveStage } from "../DeepDiveStage.js";

describe("DeepDiveStage (#294)", () => {
  it("rendert nichts, wenn die Bühne zu ist", () => {
    expect(
      renderToStaticMarkup(createElement(DeepDiveStage, { isOpen: false, onClose: vi.fn() }))
    ).toBe("");
  });

  it("Schließen-Knopf mit Symbol und Namen statt Zeichen ×", () => {
    const html = renderToStaticMarkup(
      createElement(DeepDiveStage, { isOpen: true, onClose: vi.fn() })
    );
    expect(html).toContain('aria-label="Bühne schließen"');
    expect(html).not.toContain("×");
    expect(html).toMatch(/data-testid="btn-close-deep-dive-stage"[^>]*>\s*<svg aria-hidden="true"/);
  });

  it("nennt den aktiven Sprecher nur einmal (im Transkript)", () => {
    const html = renderToStaticMarkup(
      createElement(DeepDiveStage, {
        isOpen: true,
        onClose: vi.fn(),
        currentTimeMs: 6000,
        transcriptLines: [
          {
            id: "a",
            startMs: 0,
            endMs: 5000,
            speaker: "hostA",
            speakerName: "Host Lea",
            text: "Eins"
          },
          {
            id: "b",
            startMs: 5000,
            endMs: 9000,
            speaker: "hostB",
            speakerName: "Host Jonas",
            text: "Zwei"
          }
        ]
      })
    );
    expect(html).not.toContain("rn-stage-speaker");
    expect(html.match(/>Host Jonas</g)).toHaveLength(1);
  });

  it("aktiver Sprecher außerhalb von hostA/hostB ergibt einen neutralen Orb", () => {
    const html = renderToStaticMarkup(
      createElement(DeepDiveStage, {
        isOpen: true,
        onClose: vi.fn(),
        currentTimeMs: 100,
        transcriptLines: [
          { id: "g", startMs: 0, endMs: 500, speaker: "guest", speakerName: "Gast", text: "Hallo" }
        ]
      })
    );
    expect(html).toContain('data-testid="aurora-orb-canvas"');
  });
});
