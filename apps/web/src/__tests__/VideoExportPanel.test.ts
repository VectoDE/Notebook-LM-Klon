import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VideoExportPanel } from "../VideoExportPanel.js";
import { DEFAULT_VIDEO_STORYBOARD } from "../WorkspaceLayout.js";
import { ThemeProvider, type ThemeProviderProps } from "../useTheme.js";

function render(language: "de" | "en") {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { defaultLanguage: language } as ThemeProviderProps,
      createElement(VideoExportPanel, { storyboard: DEFAULT_VIDEO_STORYBOARD })
    )
  );
}

describe("VideoExportPanel (#241)", () => {
  it("nennt Format und bietet Export mit und ohne Ton (Deutsch)", () => {
    const html = render("de");
    expect(html).toContain("Video exportieren");
    expect(html).toContain("1920 × 1080, 30 Bilder pro Sekunde");
    expect(html).toContain('data-testid="video-export-audio"');
    expect(html).toContain("WebM mit Ton exportieren");
    expect(html).toContain("Ohne Ton exportieren");
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('role="alert"');
  });

  it("Englisch", () => {
    const html = render("en");
    expect(html).toContain("Export WebM with audio");
    expect(html).toContain("30 frames per second");
  });

  it("Demo-Storyboard ist auf 1920 × 1080 bei 30 fps gestellt", () => {
    expect(DEFAULT_VIDEO_STORYBOARD.resolution).toEqual({ width: 1920, height: 1080 });
    expect(DEFAULT_VIDEO_STORYBOARD.fps).toBe(30);
  });
});
