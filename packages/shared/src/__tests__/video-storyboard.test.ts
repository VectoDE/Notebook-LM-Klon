import { describe, expect, it } from "vitest";
import {
  type GenerateVideoStoryboardOptions,
  type NotebookSourceInput,
  SlideChartDataSchema,
  SubtitleCueSchema,
  VideoChapterSchema,
  VideoSlideSchema,
  VideoStoryboardSchema,
  formatVttTimestamp,
  generateVideoStoryboard,
  generateWebVTT
} from "../video-storyboard.js";

describe("Video Storyboard & Generator (Sub-Issue #119)", () => {
  it("formats VTT timestamps accurately including hours and milliseconds", () => {
    expect(formatVttTimestamp(0)).toBe("00:00:00.000");
    expect(formatVttTimestamp(1250)).toBe("00:00:01.250");
    expect(formatVttTimestamp(65432)).toBe("00:01:05.432");
    expect(formatVttTimestamp(3661005)).toBe("01:01:01.005");
    expect(formatVttTimestamp(-500)).toBe("00:00:00.000");
  });

  it("generates valid WebVTT string from cues", () => {
    const cues = [
      { id: "c1", startTimeMs: 0, endTimeMs: 3000, text: "Erster Untertitel" },
      { id: "c2", startTimeMs: 3000, endTimeMs: 6500, text: "Zweiter Untertitel" }
    ];
    const vtt = generateWebVTT(cues);
    expect(vtt).toContain("WEBVTT - Video Overview Subtitles");
    expect(vtt).toContain("00:00:00.000 --> 00:00:03.000\nErster Untertitel");
    expect(vtt).toContain("00:00:03.000 --> 00:00:06.500\nZweiter Untertitel");
  });

  it("validates Zod schemas for slides, chapters, charts, and storyboards", () => {
    const chart = SlideChartDataSchema.parse({
      type: "bar",
      title: "Umsatzwachstum",
      data: [
        { label: "Q1", value: 100 },
        { label: "Q2", value: 150 }
      ]
    });
    expect(chart.type).toBe("bar");

    const chapter = VideoChapterSchema.parse({
      id: "ch-1",
      index: 1,
      title: "Kapitel 1",
      startTimeMs: 0,
      endTimeMs: 5000,
      slideIds: ["s-1"]
    });
    expect(chapter.index).toBe(1);

    const cue = SubtitleCueSchema.parse({
      id: "cue-1",
      startTimeMs: 0,
      endTimeMs: 2000,
      text: "Hallo"
    });
    expect(cue.text).toBe("Hallo");

    const slide = VideoSlideSchema.parse({
      id: "s-1",
      chapterIndex: 0,
      title: "Test Folie",
      bulletPoints: ["Punkt 1", "Punkt 2"],
      spokenNarration: "Das ist ein Test.",
      audioDescription: "Beschreibung der Folie fuer Screenreader.",
      startTimeMs: 0,
      endTimeMs: 5000,
      durationMs: 5000
    });
    expect(slide.visualTheme.accentColor).toBe("#3b82f6");
  });

  it("throws error when generating storyboard without sources", () => {
    expect(() =>
      generateVideoStoryboard({
        notebookId: "nb_empty",
        sources: []
      })
    ).toThrow("Mindestens eine Quelle ist zur Generierung des Video-Storyboards erforderlich.");
  });

  it("generates a full structured storyboard from sources with metrics and key findings", () => {
    const sources: NotebookSourceInput[] = [
      {
        id: "src_1",
        title: "Marktanalyse 2026",
        content:
          "Der globale Markt fuer KI-gestuetzte Wissensplattformen waechst rasant. Effizienzsteigerung steht im Fokus.",
        keyFindings: ["Wachstum um 45%", "Verbesserte Synthese", "Kollaboration im Team"],
        metrics: [
          { label: "Wachstum", value: 45, unit: "%" },
          { label: "Adoption", value: 80, unit: "%" }
        ]
      },
      {
        id: "src_2",
        title: "Sicherheits- und Compliance-Report",
        content: "DSGVO-Konformitaet und clientseitige Verschluesselung sind unverzichtbar.",
        keyFindings: ["DSGVO Pruefung bestanden", "Zero-Knowledge Architektur"]
      }
    ];

    const options: GenerateVideoStoryboardOptions = {
      notebookId: "nb_test_123",
      title: "Synthese Markt & Sicherheit",
      sources,
      targetDurationPerSlideSec: 10,
      audioUrl: "https://cdn.example.com/audio/overview.mp3"
    };

    const storyboard = generateVideoStoryboard(options);

    // Verify storyboard schema validity
    expect(VideoStoryboardSchema.safeParse(storyboard).success).toBe(true);

    // Verify slide count (Intro + 2 Sources + Outro = 4 slides)
    expect(storyboard.slides).toHaveLength(4);
    expect(storyboard.chapters).toHaveLength(4);
    expect(storyboard.durationMs).toBe(40000); // 4 slides * 10 seconds

    // Verify audio description track exists for every slide (A11y Sub-Issue #119)
    expect(storyboard.audioDescriptionTrack).toHaveLength(4);
    for (const slide of storyboard.slides) {
      expect(slide.audioDescription).toBeTruthy();
      expect(typeof slide.audioDescription).toBe("string");
      const ad = storyboard.audioDescriptionTrack.find((item) => item.slideId === slide.id);
      expect(ad).toBeDefined();
      expect(ad?.description).toBeTruthy();
    }

    // Check chart generation on first source slide
    const slide1 = storyboard.slides[1];
    expect(slide1?.chart).toBeDefined();
    expect(slide1?.chart?.type).toBe("bar");
    expect(slide1?.chart?.data).toHaveLength(2);
    expect(slide1?.citations).toHaveLength(1);
    expect(slide1?.citations[0]?.sourceTitle).toBe("Marktanalyse 2026");

    // Check fallback bullet points when keyFindings not provided
    const sourceWithoutFindings: NotebookSourceInput = {
      id: "src_3",
      title: "Standard Dokument",
      content:
        "Ein sehr langes Dokument, das absichtlich weit ueber einhundertzwanzig Zeichen lang formuliert ist, um die Ellipsis-Logik bei Zitaten in der Storyboard-Erstellung vollstaendig auf Branch-Ebene zu testen und abzudecken."
    };
    const minimalStoryboard = generateVideoStoryboard({
      notebookId: "nb_min",
      sources: [sourceWithoutFindings]
    });
    expect(minimalStoryboard.slides[1]?.bulletPoints).toHaveLength(3);
    expect(minimalStoryboard.slides[1]?.bulletPoints[0]).toContain("Analyse von Kernaspekten");
    expect(minimalStoryboard.slides[1]?.citations[0]?.quote.endsWith("...")).toBe(true);
  });
});
