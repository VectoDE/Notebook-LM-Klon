import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuroraOrb } from "../AuroraOrb.js";

describe("AuroraOrb Component (Sub-Issue #130)", () => {
  it("renders canvas container with img role and accessible label", () => {
    const html = renderToStaticMarkup(createElement(AuroraOrb, { width: 280, height: 280 }));
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Aurora Audio Orb Visualisierung"');
    expect(html).toContain('data-testid="aurora-orb-container"');
    expect(html).toContain('data-testid="aurora-orb-canvas"');
    expect(html).toContain('width="280"');
    expect(html).toContain('height="280"');
  });

  it("renders with reducedMotion flag enabled", () => {
    const html = renderToStaticMarkup(
      createElement(AuroraOrb, { isPlaying: true, reducedMotion: true, activeSpeaker: "hostA" })
    );
    expect(html).toContain('data-testid="aurora-orb-canvas"');
  });

  it("renders with active speaker hostB and custom audio level", () => {
    const html = renderToStaticMarkup(
      createElement(AuroraOrb, { isPlaying: true, activeSpeaker: "hostB", audioLevel: 0.85 })
    );
    expect(html).toContain('data-testid="aurora-orb-canvas"');
  });
});
