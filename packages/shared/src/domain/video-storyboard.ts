import { z } from "zod";

/**
 * Slide chart / metric visualization representation.
 */
export const SlideChartTypeSchema = z.enum(["bar", "line", "pie", "metric"]);
export type SlideChartType = z.infer<typeof SlideChartTypeSchema>;

export const SlideDataPointSchema = z.object({
  label: z.string().min(1),
  value: z.number(),
  color: z.string().optional()
});
export type SlideDataPoint = z.infer<typeof SlideDataPointSchema>;

export const SlideChartDataSchema = z.object({
  type: SlideChartTypeSchema,
  title: z.string().min(1),
  data: z.array(SlideDataPointSchema).min(1),
  unit: z.string().optional()
});
export type SlideChartData = z.infer<typeof SlideChartDataSchema>;

/**
 * Slide citation / source link.
 */
export const SlideCitationSchema = z.object({
  sourceId: z.string().min(1),
  sourceTitle: z.string().min(1),
  quote: z.string().min(1),
  pageNumber: z.number().int().positive().optional()
});
export type SlideCitation = z.infer<typeof SlideCitationSchema>;

/**
 * Video Overview Slide definition.
 */
export const VideoSlideSchema = z.object({
  id: z.string().min(1),
  chapterIndex: z.number().int().min(0),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  bulletPoints: z.array(z.string().min(1)).min(1),
  chart: SlideChartDataSchema.optional(),
  citations: z.array(SlideCitationSchema).default([]),
  spokenNarration: z.string().min(1),
  audioDescription: z.string().min(1), // Accessibility track for screen-readers & visually impaired
  startTimeMs: z.number().min(0),
  endTimeMs: z.number().min(0),
  durationMs: z.number().positive(),
  visualTheme: z
    .object({
      backgroundGradient: z.tuple([z.string(), z.string()]).default(["#0b0f19", "#1a2234"]),
      accentColor: z.string().default("#3b82f6"),
      textColor: z.string().default("#ffffff")
    })
    .default({
      backgroundGradient: ["#0b0f19", "#1a2234"],
      accentColor: "#3b82f6",
      textColor: "#ffffff"
    })
});
export type VideoSlide = z.infer<typeof VideoSlideSchema>;

/**
 * Video Chapter definition.
 */
export const VideoChapterSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().min(0),
  title: z.string().min(1),
  startTimeMs: z.number().min(0),
  endTimeMs: z.number().min(0),
  slideIds: z.array(z.string().min(1)).min(1)
});
export type VideoChapter = z.infer<typeof VideoChapterSchema>;

/**
 * WebVTT Subtitle Cue.
 */
export const SubtitleCueSchema = z.object({
  id: z.string().min(1),
  startTimeMs: z.number().min(0),
  endTimeMs: z.number().min(0),
  text: z.string().min(1)
});
export type SubtitleCue = z.infer<typeof SubtitleCueSchema>;

/**
 * Video Overview Storyboard.
 */
export const VideoStoryboardSchema = z.object({
  id: z.string().min(1),
  notebookId: z.string().min(1),
  title: z.string().min(1),
  durationMs: z.number().positive(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  fps: z.number().int().positive().default(60),
  resolution: z
    .object({
      width: z.number().int().positive().default(1920),
      height: z.number().int().positive().default(1080)
    })
    .default({ width: 1920, height: 1080 }),
  slides: z.array(VideoSlideSchema).min(1),
  chapters: z.array(VideoChapterSchema).min(1),
  subtitlesVtt: z.string().min(1),
  subtitles: z.array(SubtitleCueSchema),
  audioDescriptionTrack: z.array(
    z.object({
      slideId: z.string().min(1),
      startTimeMs: z.number().min(0),
      endTimeMs: z.number().min(0),
      description: z.string().min(1)
    })
  ),
  audioUrl: z.string().optional(),
  /**
   * Gebärdensprachvideo zur Übersicht (Issue #350), zeitgleich zum Folienablauf. Ohne Eintrag
   * bietet der Player die Gebärdensprache nicht an und sagt das offen. language ist ein
   * BCP-47-Code, Standard "gsg" (Deutsche Gebärdensprache, ISO 639-3).
   */
  signLanguageVideo: z
    .object({
      url: z.string().min(1),
      language: z.string().min(2).default("gsg")
    })
    .optional()
});
export type VideoStoryboard = z.infer<typeof VideoStoryboardSchema>;

/**
 * Format milliseconds to WebVTT timestamp (HH:MM:SS.mmm).
 */
export function formatVttTimestamp(ms: number): string {
  const safeMs = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safeMs / 1000);
  const milliseconds = safeMs % 1000;
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const pad = (num: number, digits = 2) => String(num).padStart(digits, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(milliseconds, 3)}`;
}

/**
 * Generate a valid WebVTT string from cues.
 */
export function generateWebVTT(cues: readonly SubtitleCue[]): string {
  let vtt = "WEBVTT - Video Overview Subtitles\n\n";
  for (const cue of cues) {
    vtt += `${cue.id}\n`;
    vtt += `${formatVttTimestamp(cue.startTimeMs)} --> ${formatVttTimestamp(cue.endTimeMs)}\n`;
    vtt += `${cue.text}\n\n`;
  }
  return `${vtt.trimEnd()}\n`;
}

export interface NotebookSourceInput {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly keyFindings?: readonly string[];
  readonly metrics?: readonly { label: string; value: number; unit?: string }[];
}

export interface GenerateVideoStoryboardOptions {
  readonly notebookId: string;
  readonly title?: string;
  readonly sources: readonly NotebookSourceInput[];
  readonly targetDurationPerSlideSec?: number;
  readonly audioUrl?: string;
}

/**
 * Generates a structured Video Storyboard from notebook sources,
 * including slides, key insights, metrics, citations, chapter bookmarks,
 * WebVTT subtitles, and an accessible audio description track.
 */
export function generateVideoStoryboard(options: GenerateVideoStoryboardOptions): VideoStoryboard {
  const {
    notebookId,
    title = "Video-Uebersicht: Quellensynthese & Analyse",
    sources,
    targetDurationPerSlideSec = 8,
    audioUrl
  } = options;

  if (sources.length === 0) {
    throw new Error(
      "Mindestens eine Quelle ist zur Generierung des Video-Storyboards erforderlich."
    );
  }

  const slideDurationMs = targetDurationPerSlideSec * 1000;
  let currentOffsetMs = 0;

  const slides: VideoSlide[] = [];
  const chapters: VideoChapter[] = [];
  const cues: SubtitleCue[] = [];
  const audioDescriptionTrack: VideoStoryboard["audioDescriptionTrack"] = [];

  // 1. Introduction Slide
  const introSlideId = "slide-intro";
  const introEndMs = currentOffsetMs + slideDurationMs;
  slides.push({
    id: introSlideId,
    chapterIndex: 0,
    title,
    subtitle: `Synthese aus ${sources.length} verknuepften Quellen`,
    bulletPoints: [
      "Strukturierte Pruefung relevanter Kernaussagen",
      "Evidenzbasierte Analyse mit Referenzen",
      "Uebersichtliche Kennzahlen und Diagramme"
    ],
    spokenNarration: `Willkommen zur Video-Uebersicht zu "${title}". In diesem Video fassen wir die Kernergebnisse aus ${sources.length} Dokumenten zusammen.`,
    audioDescription: `Titel-Folie mit der Hauptueberschrift "${title}" und drei Einleitungspunkten zur Quellenbasis vor dunklem Verlaufshintergrund.`,
    startTimeMs: currentOffsetMs,
    endTimeMs: introEndMs,
    durationMs: slideDurationMs,
    citations: [],
    visualTheme: {
      backgroundGradient: ["#0f172a", "#1e293b"],
      accentColor: "#38bdf8",
      textColor: "#ffffff"
    }
  });

  cues.push({
    id: "cue-intro",
    startTimeMs: currentOffsetMs,
    endTimeMs: introEndMs,
    text: `Willkommen zur Video-Uebersicht: ${title}.`
  });

  audioDescriptionTrack.push({
    slideId: introSlideId,
    startTimeMs: currentOffsetMs,
    endTimeMs: introEndMs,
    description: `Titel-Folie: ${title}. Synthese aus ${sources.length} Quellen.`
  });

  chapters.push({
    id: "chapter-0",
    index: 0,
    title: "Einleitung & Ueberblick",
    startTimeMs: currentOffsetMs,
    endTimeMs: introEndMs,
    slideIds: [introSlideId]
  });

  currentOffsetMs = introEndMs;

  // 2. Source-specific Slides
  sources.forEach((source, idx) => {
    const chapterIndex = idx + 1;
    const slideId = `slide-source-${idx + 1}`;
    const startMs = currentOffsetMs;
    const endMs = startMs + slideDurationMs;

    const bulletPoints =
      source.keyFindings && source.keyFindings.length > 0
        ? [...source.keyFindings.slice(0, 3)]
        : [
            `Analyse von Kernaspekten aus "${source.title}"`,
            "Validierte Datenpunkte und Argumentationslinien",
            "Relevante Erkenntnisse fuer das Notebook"
          ];

    let chart: SlideChartData | undefined;
    if (source.metrics && source.metrics.length > 0) {
      chart = {
        type: "bar",
        title: `Kennzahlen: ${source.title}`,
        data: source.metrics.map((m) => ({
          label: m.label,
          value: m.value
        })),
        unit: source.metrics[0]?.unit
      };
    }

    const citations: SlideCitation[] = [
      {
        sourceId: source.id,
        sourceTitle: source.title,
        quote: source.content.slice(0, 120).trim() + (source.content.length > 120 ? "..." : ""),
        pageNumber: 1
      }
    ];

    const spokenNarration = `Kapitel ${chapterIndex}: In Quelle ${source.title} stehen folgende Kernpunkte im Vordergrund: ${bulletPoints.join(". ")}.`;
    const audioDescription = `Folie zeigt Quelle "${source.title}" mit ${bulletPoints.length} Kernpunkten${chart ? " und einem Balkendiagramm" : ""}. Referenz-Zitat am unteren Rand eingeblendet.`;

    slides.push({
      id: slideId,
      chapterIndex,
      title: source.title,
      subtitle: `Kapitel ${chapterIndex} – Detailanalyse`,
      bulletPoints,
      chart,
      citations,
      spokenNarration,
      audioDescription,
      startTimeMs: startMs,
      endTimeMs: endMs,
      durationMs: slideDurationMs,
      visualTheme: {
        backgroundGradient: ["#0b0f19", "#1e1b4b"],
        accentColor: "#6366f1",
        textColor: "#ffffff"
      }
    });

    cues.push({
      id: `cue-${slideId}`,
      startTimeMs: startMs,
      endTimeMs: endMs,
      text: `${source.title}: ${bulletPoints[0]}`
    });

    audioDescriptionTrack.push({
      slideId,
      startTimeMs: startMs,
      endTimeMs: endMs,
      description: audioDescription
    });

    chapters.push({
      id: `chapter-${chapterIndex}`,
      index: chapterIndex,
      title: source.title,
      startTimeMs: startMs,
      endTimeMs: endMs,
      slideIds: [slideId]
    });

    currentOffsetMs = endMs;
  });

  // 3. Conclusion Slide
  const outroSlideId = "slide-outro";
  const outroEndMs = currentOffsetMs + slideDurationMs;
  const outroChapterIndex = sources.length + 1;

  slides.push({
    id: outroSlideId,
    chapterIndex: outroChapterIndex,
    title: "Fazit & Zusammenfassung",
    subtitle: "Ueberblick der Gesamtergebnisse",
    bulletPoints: [
      "Konsistente Evidenz ueber alle untersuchten Quellen",
      "Identifizierte Synergien und zentrale Handlungsfelder",
      "Vertiefung via Q&A-Chat und Audio-Overview moeglich"
    ],
    spokenNarration:
      "Zusammenfassend bestaetigen die Dokumente eine konsistente Evidenzlinie. Nutzen Sie den Studio-Chat fuer vertiefende Rueckfragen.",
    audioDescription:
      "Abschlussfolie: Zusammenfassung der Kernargumente und Hinweis auf interaktive Analysewerkzeuge.",
    startTimeMs: currentOffsetMs,
    endTimeMs: outroEndMs,
    durationMs: slideDurationMs,
    citations: [],
    visualTheme: {
      backgroundGradient: ["#090d16", "#064e3b"],
      accentColor: "#10b981",
      textColor: "#ffffff"
    }
  });

  cues.push({
    id: "cue-outro",
    startTimeMs: currentOffsetMs,
    endTimeMs: outroEndMs,
    text: "Fazit: Konsistente Evidenzlinie ueber alle untersuchten Quellen."
  });

  audioDescriptionTrack.push({
    slideId: outroSlideId,
    startTimeMs: currentOffsetMs,
    endTimeMs: outroEndMs,
    description: "Abschlussfolie mit Fazit und Synergien."
  });

  chapters.push({
    id: `chapter-${outroChapterIndex}`,
    index: outroChapterIndex,
    title: "Fazit",
    startTimeMs: currentOffsetMs,
    endTimeMs: outroEndMs,
    slideIds: [outroSlideId]
  });

  const totalDurationMs = outroEndMs;
  const subtitlesVtt = generateWebVTT(cues);

  const storyboard: VideoStoryboard = {
    id: `storyboard-${notebookId}-${Date.now()}`,
    notebookId,
    title,
    durationMs: totalDurationMs,
    aspectRatio: "16:9",
    fps: 60,
    resolution: { width: 1920, height: 1080 },
    slides,
    chapters,
    subtitlesVtt,
    subtitles: cues,
    audioDescriptionTrack,
    audioUrl
  };

  return VideoStoryboardSchema.parse(storyboard);
}
