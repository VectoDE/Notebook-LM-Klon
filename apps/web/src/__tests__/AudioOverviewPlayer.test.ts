import { buildAudioOverviewScript } from "@notebook-lm/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AudioOverviewPlayer,
  type AudioOverviewSpeechApi,
  worstVoiceFallback
} from "../AudioOverviewPlayer.js";
import { AUDIO_OVERVIEW_TEXTS, formatMinutes } from "../audio-overview-i18n.js";
import { audioOverviewSourcesFromDemo } from "../audio-overview-sources.js";
import type { SpeechUtteranceLike, SpeechVoiceLike } from "../audio-overview-speech.js";
import { ThemeProvider, type ThemeProviderProps } from "../useTheme.js";

const voice = (name: string, lang: string): SpeechVoiceLike => ({ name, lang, voiceURI: name });

function speechWith(voices: SpeechVoiceLike[]): AudioOverviewSpeechApi {
  return {
    synth: {
      speak: () => {},
      cancel: () => {},
      pause: () => {},
      resume: () => {},
      getVoices: () => voices
    },
    createUtterance: (text): SpeechUtteranceLike => ({
      text,
      lang: "",
      voice: null,
      pitch: 1,
      rate: 1,
      onend: null,
      onerror: null
    })
  };
}

const SOURCES = audioOverviewSourcesFromDemo();

function render(
  props: Parameters<typeof AudioOverviewPlayer>[0],
  language: "de" | "en" = "de"
): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { defaultLanguage: language } as ThemeProviderProps,
      createElement(AudioOverviewPlayer, props)
    )
  );
}

describe("AudioOverviewPlayer (#240)", () => {
  it("zeigt Längenwahl kurz/mittel, Sprachwahl und den Knopf zum Erstellen", () => {
    const html = render({ sources: SOURCES, speech: speechWith([]) });
    expect(html).toContain('data-testid="audio-overview-length-short"');
    expect(html).toContain('data-testid="audio-overview-length-medium"');
    expect(html).toContain("3 bis 5 Minuten");
    expect(html).toContain("8 bis 12 Minuten");
    expect(html).toContain('data-testid="audio-overview-language"');
    expect(html).toContain("Skript erstellen");
    expect(html).not.toContain('data-testid="audio-overview-transcript"');
  });

  it("mit Skript: Transkript, Zitate, Tastenkürzel und Dauer", () => {
    const script = buildAudioOverviewScript({
      sources: SOURCES,
      length: "short",
      language: "de",
      notebookTitle: "Demo"
    });
    const html = render({
      sources: SOURCES,
      initialScript: script,
      speech: speechWith([voice("Anna", "de-DE"), voice("Markus", "de-DE")])
    });
    expect(html).toContain('data-testid="audio-overview-transcript"');
    expect(html).toContain('data-speaker="host"');
    expect(html).toContain('data-speaker="expert"');
    expect(html).toContain('aria-keyshortcuts="Space K"');
    expect(html).toContain('aria-keyshortcuts="ArrowLeft J"');
    expect(html).toContain('aria-keyshortcuts="Escape"');
    expect(html).toContain("Leertaste oder K");
    expect(html).toContain('data-testid="audio-overview-citations"');
    expect(html).toContain("[1]");
    expect(html).toContain("Skript neu erstellen");
    expect(html).toContain(`etwa ${formatMinutes(script.estimatedDurationMs, "de")} Min.`);
    // Zwei Stimmen vorhanden: kein Hinweis
    expect(html).not.toContain('data-testid="audio-overview-fallback"');
    // Nur ein Beitrag aktiv, solange nichts spielt: keiner
    expect(html).not.toContain('aria-current="true"');
  });

  it("englische Oberfläche mit deutschen Quellen: lang-Attribut am Zitat", () => {
    const script = buildAudioOverviewScript({ sources: SOURCES, length: "short", language: "en" });
    const html = render(
      { sources: SOURCES, initialScript: script, speech: speechWith([voice("Sam", "en-US")]) },
      "en"
    );
    expect(html).toContain("Transcript");
    expect(html).toContain('lang="de"');
    expect(html).toContain('data-testid="audio-overview-fallback"');
    expect(html).toContain(AUDIO_OVERVIEW_TEXTS.en.fallbackNoVoice);
  });

  it("Fallback-Hinweise: eine Stimme, keine API", () => {
    const one = render({ sources: SOURCES, speech: speechWith([voice("Anna", "de-DE")]) });
    expect(one).toContain(AUDIO_OVERVIEW_TEXTS.de.fallbackSingleVoice);
    const none = render({ sources: SOURCES, speech: null });
    expect(none).toContain(AUDIO_OVERVIEW_TEXTS.de.fallbackUnsupported);
    // Ohne speech-Angabe: Browser-API, in Node nicht vorhanden
    const auto = render({ sources: SOURCES });
    expect(auto).toContain(AUDIO_OVERVIEW_TEXTS.de.fallbackUnsupported);
  });

  it("zu wenig Quellen: Hinweis; ohne Quellen ist Erstellen gesperrt", () => {
    const script = buildAudioOverviewScript({ sources: SOURCES, length: "medium", language: "de" });
    expect(script.sourcesExhausted).toBe(true);
    const html = render({ sources: SOURCES, initialScript: script, speech: speechWith([]) });
    expect(html).toContain('data-testid="audio-overview-short-note"');
    const empty = render({ sources: [], speech: speechWith([]) });
    expect(empty).toContain(AUDIO_OVERVIEW_TEXTS.de.noSources);
    expect(empty).toMatch(
      /data-testid="audio-overview-generate"[^>]*disabled|disabled[^>]*data-testid="audio-overview-generate"/
    );
  });

  it("worstVoiceFallback nimmt den ungünstigsten Fall über alle Sprachen", () => {
    const api = speechWith([voice("Sam", "en-US"), voice("Dan", "en-GB"), voice("Anna", "de-DE")]);
    expect(worstVoiceFallback(api, ["en"])).toBe("none");
    expect(worstVoiceFallback(api, ["en", "de"])).toBe("single-voice");
    expect(worstVoiceFallback(api, ["en", "fr", "de"])).toBe("no-voice");
    expect(worstVoiceFallback(null, ["en"])).toBe("unsupported");
  });

  it("Texte: beide Sprachen vollständig, Minuten im Sprachformat", () => {
    const de = AUDIO_OVERVIEW_TEXTS.de;
    const en = AUDIO_OVERVIEW_TEXTS.en;
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    expect(formatMinutes(270_000, "de")).toBe("4,5");
    expect(formatMinutes(270_000, "en")).toBe("4.5");
    expect(de.turnOf(2, 9)).toBe("Beitrag 2 von 9");
    expect(en.turnOf(2, 9)).toBe("Turn 2 of 9");
    expect(de.duration("4")).toBe("etwa 4 Min.");
    expect(en.duration("4")).toBe("about 4 min");
    expect(de.turns(3)).toBe("3 Beiträge");
    expect(en.turns(3)).toBe("3 turns");
    expect(de.sourcesShort("2")).toContain("etwa 2 Minuten");
    expect(en.sourcesShort("2")).toContain("about 2 minutes");
    expect(de.citationPage(3)).toBe(", S. 3");
    expect(en.citationPage(3)).toBe(", p. 3");
    expect(de.speechError("x")).toContain("(x)");
    expect(en.speechError("x")).toContain("(x)");
    expect(de.nowSpeaking("Host", 1)).toBe("Host, Beitrag 1");
    expect(en.nowSpeaking("Host", 1)).toBe("Host, turn 1");
  });

  it("Demo-Quellen: vier Quellen mit Abschnitten und Sprache", () => {
    expect(SOURCES).toHaveLength(4);
    expect(SOURCES.every((s) => s.lang === "de" && s.chunks.length > 0)).toBe(true);
    expect(SOURCES[0]?.chunks[0]?.pageNumber).toBe(1);
    const noPages = audioOverviewSourcesFromDemo(
      {
        id: "nb",
        title: "T",
        emoji: "x",
        description: "",
        sources: [
          {
            id: "s",
            title: "S",
            originalName: "s.md",
            mimeType: "text/markdown",
            sourceType: "md",
            byteSize: 1,
            chunks: [{ id: "c", chunkIndex: 0, text: "Text.", tokenCount: 1 }]
          }
        ],
        chats: [],
        artifacts: [],
        notes: []
      } as unknown as Parameters<typeof audioOverviewSourcesFromDemo>[0],
      "en"
    );
    expect(noPages[0]).toMatchObject({ lang: "en", chunks: [{ pageNumber: null }] });
  });
});
