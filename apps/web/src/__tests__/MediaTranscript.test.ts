import type { PodcastStateMachine } from "@notebook-lm/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEMO_PODCAST_TRANSCRIPT, DeepDiveStage } from "../DeepDiveStage.js";
import { InteractiveAudioHostPlayer } from "../InteractiveAudioHostPlayer.js";
import { MediaTranscript, activeTranscriptIndex } from "../MediaTranscript.js";

const items = [
  { id: "a", startMs: 0, endMs: 5000, speaker: "Host Lea", text: "Hallo." },
  {
    id: "b",
    startMs: 5000,
    endMs: 65_000,
    text: "Weiter.",
    chapter: "Kapitel Zwei",
    description: "Folie mit Diagramm."
  }
];

describe("MediaTranscript (#350)", () => {
  it("findet den aktiven Abschnitt; an der Grenze gewinnt der spätere", () => {
    expect(activeTranscriptIndex(items, undefined)).toBe(-1);
    expect(activeTranscriptIndex(items, 0)).toBe(0);
    expect(activeTranscriptIndex(items, 5000)).toBe(1);
    expect(activeTranscriptIndex(items, 70_000)).toBe(-1);
  });

  it("zeigt Zeit als Sprungknopf, Sprecher, Kapitel, Bildbeschreibung und Inhaltssprache", () => {
    const html = renderToStaticMarkup(
      createElement(MediaTranscript, {
        items,
        currentTimeMs: 6000,
        onSeek: vi.fn(),
        contentLang: "de",
        downloads: [{ id: "txt", label: "Transkript (.txt)", run: vi.fn() }]
      })
    );
    expect(html).toMatch(/<h3 id="[^"]+-transcript" class="rn-transcript-title">Transkript<\/h3>/);
    expect(html).toContain('data-testid="transcript-download-txt"');
    expect(html).toContain('aria-label="Abschnitte des Transkripts"');
    // Name des Sprungknopfs beginnt mit der sichtbaren Zeit (WCAG 2.5.3)
    expect(html).toContain(
      '<button type="button" class="rn-transcript-time">0:05<span class="sr-only">– an diese Stelle springen</span></button>'
    );
    expect(html).toContain(
      '<li class="rn-transcript-item" aria-current="time" data-testid="transcript-item-b">'
    );
    expect(html).toContain('<strong class="rn-transcript-speaker" lang="de">Host Lea: </strong>');
    expect(html).toContain('<p class="rn-transcript-chapter" lang="de">Kapitel Zwei</p>');
    expect(html).toContain(
      '<span class="rn-transcript-desc-label">Bild:</span> <span lang="de">Folie mit Diagramm.</span>'
    );
  });

  it("ohne Sprungfunktion steht die Zeit als Text, ohne Downloads fehlt die Leiste", () => {
    const html = renderToStaticMarkup(createElement(MediaTranscript, { items }));
    expect(html).toContain('<span class="rn-transcript-time">0:00</span>');
    expect(html).not.toContain("rn-transcript-downloads");
    expect(html).not.toContain("aria-current");
  });
});

function mockMachine(): PodcastStateMachine {
  const ctx = {
    state: "paused",
    previousState: "idle",
    currentTimeMs: 0,
    pausedAtMs: 0,
    durationMs: 20_000,
    trackUrl: null,
    interjectInputMode: null,
    currentQuestion: null,
    currentHostAnswer: null,
    hostAnswerDurationMs: 0,
    volume: 1,
    fadeStepMs: 40
  };
  return {
    getContext: () => ({ ...ctx }),
    getState: () => ctx.state,
    subscribe: () => () => {},
    dispatch: () => true
  } as unknown as PodcastStateMachine;
}

describe("Audio-Übersicht: Transkript als Textalternative (#350)", () => {
  it("bietet das Transkript an, wenn Zeilen da sind", () => {
    const html = renderToStaticMarkup(
      createElement(InteractiveAudioHostPlayer, {
        notebookId: "nb",
        stateMachine: mockMachine(),
        transcriptLines: DEMO_PODCAST_TRANSCRIPT
      })
    );
    expect(html).toMatch(
      /<button type="button" class="rn-stage-btn" aria-expanded="false" aria-controls="[^"]+-transcript" data-testid="btn-audio-transcript">Transkript zeigen<\/button>/
    );
  });

  it("ohne Zeilen fehlt der Knopf", () => {
    const html = renderToStaticMarkup(
      createElement(InteractiveAudioHostPlayer, { notebookId: "nb", stateMachine: mockMachine() })
    );
    expect(html).not.toContain("btn-audio-transcript");
  });
});

describe("Deep-Dive-Bühne: Transkript zum Herunterladen (#350)", () => {
  it("hat Downloads für Text und WebVTT, Transkript mit Inhaltssprache", () => {
    const html = renderToStaticMarkup(
      createElement(DeepDiveStage, { isOpen: true, onClose: vi.fn() })
    );
    expect(html).toContain('data-testid="btn-stage-transcript-txt"');
    expect(html).toContain('data-testid="btn-stage-transcript-vtt"');
    expect(html).toContain("Transkript (.txt)");
    expect(html).toContain("Untertitel (.vtt)");
    expect(html).toContain('<span class="rn-lyrics-text" lang="de">Willkommen zum Deep Dive!');
  });
});
