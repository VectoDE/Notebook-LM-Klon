import { describe, expect, it } from "vitest";
import {
  AUDIO_OVERVIEW_LENGTHS,
  type AudioOverviewSourceInput,
  buildAudioOverviewScript,
  countWords,
  estimateSpeechMs,
  quoteFromChunk
} from "../audio-overview-script.js";
import { CLOUDFLARE_ARCH_DEMO_NOTEBOOK } from "../demo/cloudflare-demo.js";

const MINUTE = 60_000;

/** Abschnitt mit genau `words` Wörtern, erster Satz endet nach acht Wörtern. */
function chunkText(seed: string, words: number): string {
  const list = Array.from({ length: words }, (_, i) => `${seed}${i}`);
  list[7] = `${list[7]}.`;
  return `${list.join(" ")}.`;
}

function sources(count: number, chunksPerSource: number, wordsPerChunk: number) {
  return Array.from(
    { length: count },
    (_, s): AudioOverviewSourceInput => ({
      id: `src_${s}`,
      title: `Quelle ${s}`,
      lang: "de",
      chunks: Array.from({ length: chunksPerSource }, (_, c) => ({
        id: `chk_${s}_${c}`,
        text: chunkText(`w${s}x${c}y`, wordsPerChunk),
        pageNumber: c + 1
      }))
    })
  );
}

describe("Audio-Übersicht: Skriptgenerator (#240)", () => {
  it("kurz: geschätzte Dauer liegt zwischen 3 und 5 Minuten", () => {
    const script = buildAudioOverviewScript({
      sources: sources(4, 10, 60),
      length: "short",
      language: "de",
      notebookTitle: "Testnotebook"
    });
    expect(script.estimatedDurationMs).toBeGreaterThanOrEqual(3 * MINUTE);
    expect(script.estimatedDurationMs).toBeLessThanOrEqual(5 * MINUTE);
    expect(script.withinTarget).toBe(true);
    expect(script.sourcesExhausted).toBe(false);
    expect(script.targetMinMs).toBe(3 * MINUTE);
    expect(script.targetMaxMs).toBe(5 * MINUTE);
  });

  it("mittel: geschätzte Dauer liegt zwischen 8 und 12 Minuten", () => {
    const script = buildAudioOverviewScript({
      sources: sources(5, 10, 60),
      length: "medium",
      language: "en"
    });
    expect(script.estimatedDurationMs).toBeGreaterThanOrEqual(8 * MINUTE);
    expect(script.estimatedDurationMs).toBeLessThanOrEqual(12 * MINUTE);
    expect(script.withinTarget).toBe(true);
    expect(script.length).toBe("medium");
    expect(AUDIO_OVERVIEW_LENGTHS.medium.targetMinutes).toBe(10);
  });

  it("wechselt Host und Expertin ab, jeder Expertenbeitrag zitiert genau einen Abschnitt", () => {
    const input = sources(2, 3, 40);
    const script = buildAudioOverviewScript({ sources: input, length: "short", language: "de" });
    const speakers = script.turns.map((turn) => turn.speaker);
    for (let i = 0; i < speakers.length; i++) {
      expect(speakers[i]).toBe(i % 2 === 0 ? "host" : "expert");
    }
    const cited = script.turns.filter((turn) => turn.citationIndexes.length > 0);
    expect(cited).toHaveLength(6);
    expect(script.citations.map((c) => c.index)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const turn of cited) {
      expect(turn.speaker).toBe("expert");
      expect(turn.citationIndexes).toHaveLength(1);
      const citation = script.citations[(turn.citationIndexes[0] as number) - 1];
      // Wörtliches Zitat aus dem vorgetragenen Abschnitt
      expect(turn.text.startsWith(citation?.quote ?? "?")).toBe(true);
    }
    expect(script.citations[0]).toMatchObject({
      sourceId: "src_0",
      sourceTitle: "Quelle 0",
      chunkId: "chk_0_0",
      pageNumber: 1
    });
  });

  it("Zeitachse ist lückenlos, Dauer folgt 150 Wörtern pro Minute", () => {
    const script = buildAudioOverviewScript({
      sources: sources(1, 2, 75),
      length: "short",
      language: "de"
    });
    let cursor = 0;
    for (const turn of script.turns) {
      expect(turn.startMs).toBe(cursor);
      expect(turn.durationMs).toBeGreaterThanOrEqual(1500);
      cursor += turn.durationMs;
    }
    expect(script.estimatedDurationMs).toBe(cursor);
    expect(estimateSpeechMs(150)).toBe(MINUTE);
    expect(script.turns.find((t) => t.words === 75)?.durationMs).toBe(30_000);
  });

  it("zu wenig Quellen: kürzeres Skript und ehrlicher Hinweis", () => {
    const script = buildAudioOverviewScript({
      sources: sources(1, 1, 30),
      length: "medium",
      language: "de"
    });
    expect(script.sourcesExhausted).toBe(true);
    expect(script.withinTarget).toBe(false);
    expect(script.estimatedDurationMs).toBeLessThan(8 * MINUTE);
  });

  it("Demo-Notebook: kurze Übersicht mit Zitaten aus allen vier Quellen", () => {
    const script = buildAudioOverviewScript({
      sources: CLOUDFLARE_ARCH_DEMO_NOTEBOOK.sources.map((s) => ({ ...s, lang: "de" })),
      length: "short",
      language: "de",
      notebookTitle: CLOUDFLARE_ARCH_DEMO_NOTEBOOK.title
    });
    expect(new Set(script.citations.map((c) => c.sourceId)).size).toBe(4);
    expect(script.estimatedDurationMs).toBeGreaterThan(MINUTE);
  });

  it("englisches Skript: Rahmen auf Englisch, Zitate behalten die Quellsprache", () => {
    const script = buildAudioOverviewScript({
      sources: sources(2, 1, 40),
      length: "short",
      language: "en",
      notebookTitle: "Edge"
    });
    expect(script.turns[0]?.text).toContain("Welcome to the audio overview of “Edge”");
    expect(script.turns[0]?.text).toContain("2 sources");
    expect(script.turns[0]?.lang).toBe("en");
    expect(script.turns.find((t) => t.citationIndexes.length > 0)?.lang).toBe("de");
    const outro = script.turns[script.turns.length - 2]?.text ?? "";
    expect(outro).toContain("“Quelle 0” and “Quelle 1”");
  });

  it("deutsche Rahmentexte: eine Quelle, Titelliste mit drei Quellen, Brücken wechseln", () => {
    const one = buildAudioOverviewScript({
      sources: sources(1, 3, 20),
      length: "short",
      language: "de"
    });
    expect(one.turns[0]?.text).toContain("„Quelle 0“");
    expect(one.turns[0]?.text).toContain("eine Quelle");
    const hostLines = one.turns.filter((t) => t.speaker === "host").map((t) => t.text);
    expect(hostLines).toContain("Und was folgt daraus?");
    expect(hostLines).toContain("Das klingt wichtig. Wie geht es weiter?");

    const three = buildAudioOverviewScript({
      sources: sources(3, 1, 20),
      length: "short",
      language: "de"
    });
    expect(three.turns[three.turns.length - 2]?.text).toContain(
      "„Quelle 0“, „Quelle 1“ und „Quelle 2“"
    );
    expect(three.turns.some((t) => t.text.startsWith("Weiter zur nächsten Quelle"))).toBe(true);
  });

  it("ohne Sprache an der Quelle gilt die Skriptsprache; leere Abschnitte fallen weg", () => {
    const script = buildAudioOverviewScript({
      sources: [
        { id: "empty", title: "Leer", chunks: [{ id: "e1", text: "   " }] },
        {
          id: "s1",
          title: "Ohne Sprache",
          chunks: [
            { id: "c0", text: "  " },
            { id: "c1", text: "Ein Satz ohne Seitenangabe" }
          ]
        }
      ],
      length: "short",
      language: "en"
    });
    expect(script.citations).toHaveLength(1);
    expect(script.citations[0]?.pageNumber).toBeNull();
    expect(script.citations[0]?.quote).toBe("Ein Satz ohne Seitenangabe");
    expect(script.turns.find((t) => t.citationIndexes.length > 0)?.lang).toBe("en");
    expect(script.turns[0]?.text).toContain("one source");
  });

  it("ohne Quellen entsteht nur Ein- und Ausleitung", () => {
    const script = buildAudioOverviewScript({ sources: [], length: "short", language: "de" });
    expect(script.turns).toHaveLength(4);
    expect(script.turns[0]?.text).toContain("„Notebook“");
    expect(script.citations).toHaveLength(0);
    expect(script.sourcesExhausted).toBe(true);
    expect(script.turns[2]?.text).toBe("Damit sind wir am Ende.");
    const en = buildAudioOverviewScript({ sources: [], length: "short", language: "en" });
    expect(en.turns[2]?.text).toBe("That brings us to the end.");
  });

  it("ein Abschnitt über der Höchstdauer wird nicht aufgenommen", () => {
    const script = buildAudioOverviewScript({
      sources: [
        {
          id: "big",
          title: "Riesig",
          chunks: [{ id: "b1", text: chunkText("x", 900) }]
        }
      ],
      length: "short",
      language: "de"
    });
    expect(script.citations).toHaveLength(0);
    expect(script.sourcesExhausted).toBe(false);
  });

  it("Hilfsfunktionen: Wörter zählen und Zitat kürzen", () => {
    expect(countWords("  eins  zwei\ndrei ")).toBe(3);
    expect(quoteFromChunk("Erster Satz. Zweiter Satz.")).toBe("Erster Satz.");
    const long = `${"a".repeat(200)}.`;
    const quote = quoteFromChunk(long);
    expect(quote).toHaveLength(160);
    expect(quote.endsWith("…")).toBe(true);
  });
});
