import {
  AudioInterjectRequestSchema,
  AudioInterjectResponseSchema,
  PodcastStateMachine,
  buildAudioInterjectPrompt,
  parseAudioHostTurns
} from "@notebook-lm/shared";
import { describe, expect, it } from "vitest";

describe("audio-interject-types & schemas (Decision #68)", () => {
  it("validates valid and invalid AudioInterjectRequestSchema", () => {
    const valid = AudioInterjectRequestSchema.parse({
      userQuestion: "Wie wird die DSGVO-Loeschung garantiert?",
      currentTimeMs: 42000,
      podcastContext: "Vorher ging es um Cloudflare D1 und R2.",
      voiceMode: "dialogue"
    });
    expect(valid.userQuestion).toBe("Wie wird die DSGVO-Loeschung garantiert?");
    expect(valid.currentTimeMs).toBe(42000);
    expect(valid.host1Name).toBe("Dr. Maria Weber");
    expect(valid.host2Name).toBe("Thomas Koch");

    // Defaults when optional fields omitted
    const minimal = AudioInterjectRequestSchema.parse({
      userQuestion: "Kurze Frage?"
    });
    expect(minimal.currentTimeMs).toBe(0);
    expect(minimal.podcastContext).toBe("");
    expect(minimal.voiceMode).toBe("dialogue");

    // Invalid when question is empty
    expect(() =>
      AudioInterjectRequestSchema.parse({
        userQuestion: "   "
      })
    ).toThrow();
  });

  it("validates AudioInterjectResponseSchema", () => {
    const payload = {
      notebookId: "nb_123",
      question: "Test Frage",
      currentTimeMs: 15000,
      turns: [
        {
          speaker: "host1",
          speakerName: "Dr. Maria Weber",
          text: "Gute Frage! Das regelt Art. 17 DSGVO [1]."
        },
        {
          speaker: "host2",
          speakerName: "Thomas Koch",
          text: "Genau, und technisch loeschen wir in D1 und R2."
        }
      ],
      fullAnswer:
        "Dr. Maria Weber: Gute Frage! Das regelt Art. 17 DSGVO [1].\nThomas Koch: Genau, und technisch loeschen wir in D1 und R2.",
      citations: [
        {
          index: 1,
          chunkId: "chk_01",
          sourceId: "src_01",
          sourceTitle: "DSGVO Leitfaden",
          page: 4,
          startOffset: 10,
          endOffset: 50,
          quote: "Recht auf Vergessenwerden"
        }
      ],
      speechSynthesis: {
        mode: "dialogue",
        estimatedDurationMs: 6500,
        cues: [
          {
            speaker: "host1",
            speakerName: "Dr. Maria Weber",
            text: "Gute Frage! Das regelt Art. 17 DSGVO [1].",
            voiceName: "de-DE-Neural2-F",
            rate: 1.0
          }
        ]
      },
      aiMetadata: {
        aiGenerated: true,
        provider: "google",
        model: "gemini-2.5-flash",
        latencyMs: 320,
        timestamp: new Date().toISOString()
      }
    };

    const parsed = AudioInterjectResponseSchema.parse(payload);
    expect(parsed.notebookId).toBe("nb_123");
    expect(parsed.turns).toHaveLength(2);
    expect(parsed.citations[0]?.index).toBe(1);
    expect(parsed.aiMetadata.aiGenerated).toBe(true);
  });

  it("buildAudioInterjectPrompt structures dialog instructions with or without context", () => {
    const promptWithContext = buildAudioInterjectPrompt({
      userQuestion: "Gibt es Offline-Support?",
      currentTimeMs: 45000,
      podcastContext: "Segment ueber PWA und Service Worker.",
      groundedXml: '<context_sources><source index="1">PWA Chunks</source></context_sources>',
      host1Name: "Host A",
      host2Name: "Host B",
      voiceMode: "dialogue"
    });

    expect(promptWithContext).toContain("Host 1 (Host A)");
    expect(promptWithContext).toContain("Host 2 (Host B)");
    expect(promptWithContext).toContain("45s (45000 ms)");
    expect(promptWithContext).toContain("Segment ueber PWA und Service Worker.");
    expect(promptWithContext).toContain("Gibt es Offline-Support?");
    expect(promptWithContext).toContain("<context_sources>");

    const promptEmptyContext = buildAudioInterjectPrompt({
      userQuestion: "Was ist RelationNotes?",
      currentTimeMs: 0,
      podcastContext: "",
      groundedXml: "<context_sources/>",
      host1Name: "Host A",
      host2Name: "Host B"
    });
    expect(promptEmptyContext).toContain("[Kein vorheriger Kontext übermittelt]");
  });

  it("parseAudioHostTurns parses dialog prefixes correctly", () => {
    const raw = `
Dr. Maria Weber: Das ist ein interessanter Punkt [1]. Wir sehen in der Praxis haeufig Unsicherheiten.
Thomas Koch: Absolut, Maria. Vor allem bei kleinen Teams ohne Vollzeit-DPO.
Dr. Maria Weber: Kehren wir zurueck zum Hauptthema.
`;
    const turns = parseAudioHostTurns(raw, "Dr. Maria Weber", "Thomas Koch");
    expect(turns).toHaveLength(3);
    expect(turns[0]).toEqual({
      speaker: "host1",
      speakerName: "Dr. Maria Weber",
      text: "Das ist ein interessanter Punkt [1]. Wir sehen in der Praxis haeufig Unsicherheiten."
    });
    expect(turns[1]).toEqual({
      speaker: "host2",
      speakerName: "Thomas Koch",
      text: "Absolut, Maria. Vor allem bei kleinen Teams ohne Vollzeit-DPO."
    });
    expect(turns[2]).toEqual({
      speaker: "host1",
      speakerName: "Dr. Maria Weber",
      text: "Kehren wir zurueck zum Hauptthema."
    });
  });

  it("parseAudioHostTurns handles fallback to single turn when no prefix matches", () => {
    const raw = "Eine ganz normale unformatierte Antwort ohne Praefix.";
    const turns = parseAudioHostTurns(raw, "Host 1", "Host 2");
    expect(turns).toHaveLength(1);
    expect(turns[0]?.speaker).toBe("host1");
    expect(turns[0]?.text).toBe(raw);

    const emptyTurns = parseAudioHostTurns("", "Host 1", "Host 2");
    expect(emptyTurns).toHaveLength(0);

    const whitespaceTurns = parseAudioHostTurns("   \n   ", "Host 1", "Host 2");
    expect(whitespaceTurns).toHaveLength(0);
  });

  it("parseAudioHostTurns handles generic 'host 1:' and 'host 2:' prefixes and multiline continuations", () => {
    const raw = `
Host 1: Erste Zeile von Host 1.
Zweite Zeile gehoert noch zu Host 1.
Host 2: Antwort von Host 2.
Noch mehr Details von Host 2.
`;
    const turns = parseAudioHostTurns(raw, "Alice", "Bob");
    expect(turns).toHaveLength(2);
    expect(turns[0]?.speaker).toBe("host1");
    expect(turns[0]?.text).toContain("Erste Zeile");
    expect(turns[0]?.text).toContain("Zweite Zeile");
    expect(turns[1]?.speaker).toBe("host2");
    expect(turns[1]?.text).toContain("Antwort von Host 2");
    expect(turns[1]?.text).toContain("Noch mehr Details");

    // Test with prefix on its own line followed by content
    const separateLine = `
Host 1:
Erste getrennte Zeile
Host 2:
Zweite getrennte Zeile
`;
    const sepTurns = parseAudioHostTurns(separateLine, "Alice", "Bob");
    expect(sepTurns).toHaveLength(2);
    expect(sepTurns[0]?.text).toBe("Erste getrennte Zeile");
    expect(sepTurns[1]?.text).toBe("Zweite getrennte Zeile");
  });
});

describe("PodcastStateMachine (Sub-Issue #118)", () => {
  it("initializes in idle state and transitions through full interjection cycle", async () => {
    const machine = new PodcastStateMachine({ fadeDurationMs: 10 });
    expect(machine.getState()).toBe("idle");

    const events: string[] = [];
    machine.subscribe((ctx) => {
      events.push(`${ctx.state}:${ctx.currentTimeMs}:${ctx.volume}`);
    });

    // 1. Load podcast track
    expect(
      machine.dispatch({
        type: "LOAD",
        durationMs: 180000,
        trackUrl: "https://example.com/audio.mp3"
      })
    ).toBe(true);
    expect(machine.getState()).toBe("paused");
    expect(machine.getContext().durationMs).toBe(180000);

    // 2. Play
    expect(machine.dispatch({ type: "PLAY" })).toBe(true);
    expect(machine.getState()).toBe("playing");

    // 3. Time update
    expect(machine.dispatch({ type: "TIME_UPDATE", currentTimeMs: 45000 })).toBe(true);
    expect(machine.getContext().currentTimeMs).toBe(45000);

    // 4. Interject ('Beitreten / Frage stellen')
    expect(machine.dispatch({ type: "JOIN_INTERJECT" })).toBe(true);
    expect(machine.getState()).toBe("interjecting");
    expect(machine.getContext().pausedAtMs).toBe(45000);
    expect(machine.getContext().volume).toBe(0.0);
    expect(machine.getContext().interjectInputMode).toBe("text");

    // 5. Submit Question
    expect(machine.dispatch({ type: "SUBMIT_QUESTION", question: "Wie loest ihr das?" })).toBe(
      true
    );
    expect(machine.getContext().currentQuestion).toBe("Wie loest ihr das?");

    // 6. Host Answer Start
    expect(
      machine.dispatch({
        type: "HOST_ANSWER_START",
        answerText: "Host 1: Ganz einfach mit D1."
      })
    ).toBe(true);
    expect(machine.getState()).toBe("answering");
    expect(machine.getContext().currentHostAnswer).toBe("Host 1: Ganz einfach mit D1.");
    expect(machine.getContext().hostAnswerDurationMs).toBe(0);

    // 7. Host Answer Complete -> resuming
    expect(machine.dispatch({ type: "HOST_ANSWER_COMPLETE" })).toBe(true);
    expect(machine.getState()).toBe("resuming");

    // 8. Resume Confirmed -> returns to playing at exact pausedAtMs
    expect(machine.dispatch({ type: "RESUME_CONFIRMED" })).toBe(true);
    expect(machine.getState()).toBe("playing");
    expect(machine.getContext().currentTimeMs).toBe(45000);
    expect(machine.getContext().volume).toBe(1.0);
    expect(machine.getContext().currentQuestion).toBe(null);

    // 9. Pause and Stop
    expect(machine.dispatch({ type: "PAUSE" })).toBe(true);
    expect(machine.getState()).toBe("paused");
    expect(machine.dispatch({ type: "STOP" })).toBe(true);
    expect(machine.getState()).toBe("idle");
    expect(machine.getContext().currentTimeMs).toBe(0);
  });

  it("handles cancel interjection (Escape) and restores paused timestamp", () => {
    const machine = new PodcastStateMachine();
    machine.dispatch({ type: "LOAD", durationMs: 120000 });
    machine.dispatch({ type: "PLAY" });
    machine.dispatch({ type: "TIME_UPDATE", currentTimeMs: 33000 });

    // Interject
    machine.dispatch({ type: "JOIN_INTERJECT", inputMode: "text" });
    expect(machine.getState()).toBe("interjecting");
    expect(machine.getContext().pausedAtMs).toBe(33000);

    // Cancel -> resumes playing since previousState was playing
    expect(machine.dispatch({ type: "CANCEL_INTERJECT" })).toBe(true);
    expect(machine.getState()).toBe("playing");
    expect(machine.getContext().currentTimeMs).toBe(33000);
    expect(machine.getContext().volume).toBe(1.0);

    // Test cancel when was paused before interject
    machine.dispatch({ type: "PAUSE" });
    machine.dispatch({ type: "JOIN_INTERJECT", inputMode: "text" });
    expect(machine.getState()).toBe("interjecting");
    expect(machine.dispatch({ type: "CANCEL_INTERJECT" })).toBe(true);
    expect(machine.getState()).toBe("paused");

    // Test calling PLAY when already playing (returns false)
    machine.dispatch({ type: "PLAY" });
    expect(machine.dispatch({ type: "PLAY" })).toBe(false);

    // JOIN_INTERJECT aus "Bereit" (idle) startet die Wiedergabe und öffnet die Frage
    machine.dispatch({ type: "STOP" });
    expect(machine.getState()).toBe("idle");
    expect(machine.dispatch({ type: "JOIN_INTERJECT", inputMode: "text" })).toBe(true);
    expect(machine.getState()).toBe("interjecting");
    expect(machine.getContext().previousState).toBe("playing");
    expect(machine.getContext().interjectInputMode).toBe("text");
    expect(machine.getContext().volume).toBe(0.0);
    // Abbrechen kehrt in die laufende Wiedergabe zurück
    expect(machine.dispatch({ type: "CANCEL_INTERJECT" })).toBe(true);
    expect(machine.getState()).toBe("playing");

    // In Zuständen ohne Wiedergabekontext bleibt JOIN_INTERJECT wirkungslos
    machine.dispatch({ type: "JOIN_INTERJECT" });
    expect(machine.dispatch({ type: "JOIN_INTERJECT" })).toBe(false);
  });

  it("ignores invalid transitions and events safely", () => {
    const machine = new PodcastStateMachine();
    expect(machine.getState()).toBe("idle");

    // Cannot pause or update time in idle
    expect(machine.dispatch({ type: "PAUSE" })).toBe(false);
    expect(machine.dispatch({ type: "TIME_UPDATE", currentTimeMs: 100 })).toBe(false);
    expect(machine.dispatch({ type: "CANCEL_INTERJECT" })).toBe(false);
    expect(machine.dispatch({ type: "SUBMIT_QUESTION", question: "test" })).toBe(false);
    expect(machine.dispatch({ type: "HOST_ANSWER_START", answerText: "test" })).toBe(false);
    expect(machine.dispatch({ type: "HOST_ANSWER_COMPLETE" })).toBe(false);
    expect(machine.dispatch({ type: "RESUME_CONFIRMED" })).toBe(false);
    expect(
      machine.dispatch({ type: "INVALID" } as unknown as Parameters<
        PodcastStateMachine["dispatch"]
      >[0])
    ).toBe(false);

    // Test unsubscribe
    const listener = () => {};
    const unsub = machine.subscribe(listener);
    unsub();
  });

  it("performs smooth volume fadeOut and fadeIn", async () => {
    const machine = new PodcastStateMachine({ fadeDurationMs: 10, initialVolume: 0.8 });
    expect(machine.getContext().volume).toBe(0.8);

    await machine.fadeOut(2);
    expect(machine.getContext().volume).toBe(0);

    await machine.fadeIn(1.0, 2);
    expect(machine.getContext().volume).toBe(1.0);
  });
});
