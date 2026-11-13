import { describe, expect, it } from "vitest";
import {
  MAX_CAPTION_CHARS,
  buildWebVtt,
  clockTime,
  describeSlide,
  escapeVttText,
  splitCaptionText,
  spokenLinesToCues,
  spokenTranscriptToText,
  storyboardCaptionCues,
  storyboardDescriptionCues,
  storyboardTranscript,
  timeCaptionPieces,
  videoTranscriptToText,
  vttTimestamp
} from "../media-alternatives.js";
import { VideoStoryboardSchema, generateVideoStoryboard } from "../video-storyboard.js";

const storyboard = generateVideoStoryboard({
  notebookId: "nb_1",
  title: "Edge <Stack> & RAG",
  targetDurationPerSlideSec: 10,
  sources: [
    {
      id: "src_1",
      title: "Worker-Studie",
      content: "Ein Worker bedient alle Routen.",
      keyFindings: ["Ein Einstiegspunkt", "Kurze Kaltstarts"],
      metrics: [
        { label: "Q1", value: 30, unit: "%" },
        { label: "Q2", value: 45 }
      ]
    },
    { id: "src_2", title: "Vektoren", content: "int8 spart Speicher." }
  ]
});

/** Parst WebVTT grob: Kopf, Blöcke mit Kennung, Zeit und Text (wie ein Browser). */
function parseVtt(vtt: string) {
  const [head, ...blocks] = vtt.trimEnd().split("\n\n");
  return {
    head,
    cues: blocks.map((block) => {
      const [id, timing, ...text] = block.split("\n");
      const match = /^(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})$/.exec(
        timing ?? ""
      );
      return { id, timing: match ? [match[1], match[2]] : null, text: text.join("\n") };
    })
  };
}

describe("WebVTT", () => {
  it("formatiert Zeitstempel mit Stunden und Millisekunden", () => {
    expect(vttTimestamp(0)).toBe("00:00:00.000");
    expect(vttTimestamp(3_723_045)).toBe("01:02:03.045");
    expect(vttTimestamp(-5)).toBe("00:00:00.000");
    expect(vttTimestamp(999.6)).toBe("00:00:01.000");
  });

  it("maskiert Sonderzeichen und bricht --> im Cue-Text", () => {
    expect(escapeVttText("a < b && c > d")).toBe("a &lt; b &amp;&amp; c &gt; d");
    expect(escapeVttText("x --> y")).toBe("x --&gt; y");
    expect(escapeVttText("zwei\n\nZeilen  hier")).toBe("zwei Zeilen hier");
  });

  it("baut gültiges WebVTT: sortiert, ohne leere Cues, mit Stimme und sicherem Kopf", () => {
    const vtt = buildWebVtt(
      [
        { id: "b", startMs: 2000, endMs: 3000, text: "Zweiter" },
        { id: "a-->x", startMs: 0, endMs: 1000, text: "Erster <b>", speaker: "Host <Lea>" },
        { id: "leer", startMs: 0, endMs: 1000, text: "   " },
        { id: "null", startMs: 500, endMs: 500, text: "ohne Dauer" }
      ],
      "Titel --> mit\nUmbruch"
    );
    const parsed = parseVtt(vtt);
    expect(parsed.head).toBe("WEBVTT - Titel -> mit Umbruch");
    expect(parsed.cues).toEqual([
      {
        id: "a->x",
        timing: ["00:00:00.000", "00:00:01.000"],
        text: "<v Host &lt;Lea&gt;>Erster &lt;b&gt;"
      },
      { id: "b", timing: ["00:00:02.000", "00:00:03.000"], text: "Zweiter" }
    ]);
    expect(vtt.endsWith("\n")).toBe(true);
    expect(buildWebVtt([])).toBe("WEBVTT\n");
  });
});

describe("Untertitel aus dem Sprechertext", () => {
  it("fasst kurze Sätze zusammen und teilt lange an Wortgrenzen", () => {
    expect(splitCaptionText("Eins. Zwei! Drei?")).toEqual(["Eins. Zwei! Drei?"]);
    const long = `${"Wort ".repeat(40).trim()}.`;
    const pieces = splitCaptionText(long, 30);
    expect(pieces.every((p) => p.length <= 30)).toBe(true);
    expect(pieces.join(" ")).toBe(long);
    expect(splitCaptionText("Satz eins ist da. Satz zwei auch.", 20)).toEqual([
      "Satz eins ist da.",
      "Satz zwei auch."
    ]);
    expect(splitCaptionText("   ")).toEqual([]);
  });

  it("verteilt Stücke anteilig und lückenlos über die Folie", () => {
    const cues = timeCaptionPieces("c", ["aa", "aaaaaa"], 1000, 9000, "Lea");
    expect(cues).toEqual([
      { id: "c-1", startMs: 1000, endMs: 3000, text: "aa", speaker: "Lea" },
      { id: "c-2", startMs: 3000, endMs: 9000, text: "aaaaaa", speaker: "Lea" }
    ]);
    expect(timeCaptionPieces("c", ["x"], 0, 10)[0]).not.toHaveProperty("speaker");
  });

  it("deckt jede Folie ab, jeder Cue ist höchstens 84 Zeichen lang", () => {
    const cues = storyboardCaptionCues(storyboard);
    for (const slide of storyboard.slides) {
      const own = cues.filter((c) => c.id.startsWith(`cap-${slide.id}-`));
      expect(own[0]?.startMs).toBe(slide.startTimeMs);
      expect(own.at(-1)?.endMs).toBe(slide.endTimeMs);
      expect(own.map((c) => c.text).join(" ")).toBe(slide.spokenNarration.replace(/\s+/g, " "));
    }
    expect(cues.every((c) => c.text.length <= MAX_CAPTION_CHARS)).toBe(true);
    const parsed = parseVtt(buildWebVtt(cues));
    expect(parsed.cues.every((c) => c.timing !== null)).toBe(true);
  });
});

describe("Audiodeskription", () => {
  it("beschreibt Titel, Punkte, Diagramm und Quelle (DE und EN)", () => {
    const slide = storyboard.slides[1];
    if (!slide) throw new Error("Folie fehlt");
    const de = describeSlide(slide);
    expect(de).toContain(slide.audioDescription);
    expect(de).toContain("Worker-Studie – Kapitel 1 – Detailanalyse.");
    expect(de).toContain("Punkte auf der Folie: Ein Einstiegspunkt; Kurze Kaltstarts.");
    expect(de).toContain("Diagramm „Kennzahlen: Worker-Studie“: Q1 30%, Q2 45%.");
    expect(de).toContain("Quelle: Worker-Studie.");
    const en = describeSlide(slide, "en");
    expect(en).toContain("Points on the slide:");
    expect(en).toContain("Chart „Kennzahlen: Worker-Studie“");
    expect(en).toContain("Source: Worker-Studie.");
  });

  it("ohne Untertitel, Diagramm und Quelle bleibt die Beschreibung knapp", () => {
    const slide = VideoStoryboardSchema.shape.slides.element.parse({
      id: "s",
      chapterIndex: 0,
      title: "Fazit!",
      bulletPoints: ["A"],
      chart: { type: "bar", title: "leer", data: [{ label: "x", value: 1 }] },
      spokenNarration: "Text",
      audioDescription: "Abschluss:",
      startTimeMs: 0,
      endTimeMs: 1,
      durationMs: 1
    });
    expect(describeSlide({ ...slide, chart: undefined })).toBe(
      "Abschluss: Fazit! Punkte auf der Folie: A."
    );
    expect(describeSlide(slide)).toContain("Diagramm „leer“: x 1.");
  });

  it("liefert eine Beschreibung je Folie, zeitgleich zur Folie", () => {
    const cues = storyboardDescriptionCues(storyboard, "en");
    expect(cues).toHaveLength(storyboard.slides.length);
    cues.forEach((cue, i) => {
      expect(cue.startMs).toBe(storyboard.slides[i]?.startTimeMs);
      expect(cue.endMs).toBe(storyboard.slides[i]?.endTimeMs);
    });
    expect(storyboardDescriptionCues(storyboard)[0]?.text).toContain("Punkte auf der Folie");
  });
});

describe("Transkript", () => {
  it("enthält Kapitel, Sprechertext und Bildbeschreibung je Folie", () => {
    const entries = storyboardTranscript(storyboard);
    expect(entries).toHaveLength(storyboard.slides.length);
    expect(entries[0]?.chapter).toBe("Einleitung & Ueberblick");
    expect(entries[1]?.narration).toContain("Kapitel 1");
    const text = videoTranscriptToText(storyboard.title, entries);
    expect(text.startsWith("Edge <Stack> & RAG – Transkript\n\n[0:00–0:10] Kapitel: ")).toBe(true);
    expect(text).toContain("Bild: ");
    const en = videoTranscriptToText("T", storyboardTranscript(storyboard, "en"), "en");
    expect(en).toContain("T – Transcript");
    expect(en).toContain("Chapter: ");
    expect(en).toContain("Visual: ");
  });

  it("lässt die Kapitelangabe weg, wenn keine Folie zugeordnet ist", () => {
    const text = videoTranscriptToText("T", [
      {
        id: "x",
        startMs: 0,
        endMs: 3_700_000,
        chapter: undefined,
        narration: "N",
        description: "D"
      }
    ]);
    expect(text).toContain("[0:00–1:01:40]\nN\nBild: D");
  });

  it("macht aus gesprochenen Zeilen Cues mit Stimme und Klartext", () => {
    const lines = [
      { id: "l1", startMs: 0, endMs: 4000, speakerName: "Host Lea", text: "Hallo  du." },
      { id: "l2", startMs: 4000, endMs: 65_000, speakerName: "Host Jonas", text: "Hi." }
    ];
    const vtt = buildWebVtt(spokenLinesToCues(lines));
    expect(vtt).toContain("<v Host Lea>Hallo du.");
    expect(spokenTranscriptToText("Pod", lines)).toBe(
      "Pod – Transkript\n\n[0:00] Host Lea: Hallo du.\n[0:04] Host Jonas: Hi.\n"
    );
    expect(spokenTranscriptToText("Pod", lines, "en")).toContain("Pod – Transcript");
    expect(clockTime(65_000)).toBe("1:05");
    expect(clockTime(-1)).toBe("0:00");
  });
});

describe("Gebärdensprachvideo im Storyboard", () => {
  it("ist optional und hat Deutsche Gebärdensprache als Standard", () => {
    expect(storyboard.signLanguageVideo).toBeUndefined();
    const parsed = VideoStoryboardSchema.parse({
      ...storyboard,
      signLanguageVideo: { url: "/media/dgs.webm" }
    });
    expect(parsed.signLanguageVideo).toEqual({ url: "/media/dgs.webm", language: "gsg" });
  });
});
