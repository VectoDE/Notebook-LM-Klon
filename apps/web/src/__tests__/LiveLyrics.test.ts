import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LiveLyrics, type TranscriptLine } from "../LiveLyrics.js";

const sampleLines: readonly TranscriptLine[] = [
  {
    id: "l1",
    startMs: 0,
    endMs: 3000,
    speaker: "hostA",
    speakerName: "Host A",
    text: "Erste Zeile des Podcasts."
  },
  {
    id: "l2",
    startMs: 3000,
    endMs: 7000,
    speaker: "hostB",
    speakerName: "Host B",
    text: "Zweite Zeile im aktiven Fokus."
  },
  {
    id: "l3",
    startMs: 7000,
    endMs: 12000,
    speaker: "hostA",
    speakerName: "Host A",
    text: "Dritte noch ausstehende Zeile."
  }
];

describe("LiveLyrics Component (Sub-Issue #130)", () => {
  it("renders transcript lines with accessible roles, speakers and active sentence location", () => {
    const onSeek = vi.fn();
    const html = renderToStaticMarkup(
      createElement(LiveLyrics, {
        lines: sampleLines,
        currentTimeMs: 4500, // In range of line 2
        onSeek,
        isPlaying: true
      })
    );

    expect(html).toContain('aria-label="Live Transkript und Songtexte"');
    expect(html).toContain('data-testid="live-lyrics-container"');
    expect(html).toContain('data-testid="lyrics-line-l1"');
    expect(html).toContain('data-testid="lyrics-line-l2"');
    expect(html).toContain('aria-current="location"'); // Active line 2
    expect(html).toContain("Host A");
    expect(html).toContain("Host B");
    expect(html).toContain("Zweite Zeile im aktiven Fokus.");
  });

  it("renders with reducedMotion flag enabled", () => {
    const html = renderToStaticMarkup(
      createElement(LiveLyrics, {
        lines: sampleLines,
        currentTimeMs: 1000,
        reducedMotion: true
      })
    );
    expect(html).toContain('data-testid="lyrics-line-l1"');
    expect(html).toContain('aria-current="location"');
  });

  it("handles state when playback is before first line or after last line", () => {
    const html = renderToStaticMarkup(
      createElement(LiveLyrics, {
        lines: sampleLines,
        currentTimeMs: 20000 // past end
      })
    );
    expect(html).not.toContain('aria-current="location"');
  });

  it("wählt an der Grenze zweier Zeilen die spätere (Sprung auf startMs)", () => {
    const html = renderToStaticMarkup(
      createElement(LiveLyrics, { lines: sampleLines, currentTimeMs: 7000 })
    );
    expect(html).toMatch(/aria-current="location"[^>]*data-testid="lyrics-line-l3"/);
    expect(html).not.toMatch(/aria-current="location"[^>]*data-testid="lyrics-line-l2"/);
  });
});

describe("LiveLyrics Label-in-Name (#314)", () => {
  it("Zeilen tragen kein eigenes aria-label, der Name ist der sichtbare Text", () => {
    const html = renderToStaticMarkup(
      createElement(LiveLyrics, { lines: sampleLines, currentTimeMs: 0 })
    );
    expect(html).not.toMatch(/<button[^>]*aria-label=/);
    expect(html).toContain("Host A");
  });
});
