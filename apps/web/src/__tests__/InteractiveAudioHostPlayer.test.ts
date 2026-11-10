import type { PodcastStateMachine, PodcastStateMachineContext } from "@notebook-lm/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InteractiveAudioHostPlayer } from "../InteractiveAudioHostPlayer.js";

function createMockStateMachine(initialState = "paused"): PodcastStateMachine {
  const ctx: PodcastStateMachineContext = {
    state: initialState as PodcastStateMachineContext["state"],
    previousState: "idle",
    currentTimeMs: 15000,
    pausedAtMs: 15000,
    durationMs: 120000,
    trackUrl: "https://example.com/podcast.mp3",
    interjectInputMode: null,
    currentQuestion: null,
    currentHostAnswer: null,
    hostAnswerDurationMs: 0,
    volume: 1.0,
    fadeStepMs: 40
  };

  return {
    getContext: () => ({ ...ctx }),
    getState: () => ctx.state,
    subscribe: () => () => {},
    dispatch: () => true,
    fadeOut: async () => {},
    fadeIn: async () => {}
  } as unknown as PodcastStateMachine;
}

describe("InteractiveAudioHostPlayer (Sub-Issue #117)", () => {
  it("renders player in paused state with accessible controls and ARIA live status", () => {
    const sm = createMockStateMachine("paused");
    const html = renderToStaticMarkup(
      createElement(InteractiveAudioHostPlayer, {
        notebookId: "nb_123",
        stateMachine: sm,
        currentTrackTitle: "Test Podcast Episode"
      })
    );

    expect(html).toContain('aria-label="Interaktiver Audio-Player &amp; Host-Studio"');
    expect(html).toContain("Test Podcast Episode");
    expect(html).toContain("Beitreten / Frage stellen");
    expect(html).toContain("Abspielen");
    expect(html).toContain('data-testid="a11y-live-status"');
    expect(html).toContain('aria-live="polite"');
  });

  it("renders player in playing state with pause button", () => {
    const sm = createMockStateMachine("playing");
    const html = renderToStaticMarkup(
      createElement(InteractiveAudioHostPlayer, {
        notebookId: "nb_123",
        stateMachine: sm
      })
    );

    expect(html).toContain("Pausieren");
    expect(html).toContain("Beitreten / Frage stellen");
  });

  it("renders accessible interjection dialog when in 'interjecting' state", () => {
    const sm = createMockStateMachine("interjecting");
    const html = renderToStaticMarkup(
      createElement(InteractiveAudioHostPlayer, {
        notebookId: "nb_123",
        stateMachine: sm
      })
    );

    expect(html).toContain("<dialog");
    expect(html).toContain("interject-dialog");
    expect(html).toContain("Frage an die Podcast-Hosts stellen");
    expect(html).toContain("Ihre Zwischenfrage:");
    expect(html).toContain("Sprechen (Mikrofon)");
    expect(html).toContain("Abbrechen (Esc)");
  });

  it("renders host answer stage when in 'answering' state", () => {
    const sm = createMockStateMachine("answering");
    const html = renderToStaticMarkup(
      createElement(InteractiveAudioHostPlayer, {
        notebookId: "nb_123",
        stateMachine: sm
      })
    );

    expect(html).toContain('aria-label="Interaktiver Audio-Player &amp; Host-Studio"');
  });
});
