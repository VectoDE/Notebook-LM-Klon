import type { VideoSlide, VideoStoryboard } from "./video-storyboard.js";

/**
 * Medienalternativen (Issue #350): Untertitel, Transkript und Audiodeskription aus dem
 * vorhandenen Sprechertext und den Folieninhalten. Alles entsteht aus Daten, die das Studio
 * ohnehin hat; es wird nichts erfunden und nichts übersetzt.
 */

/** Ein zeitlich verankerter Text: Untertitel, Beschreibung oder Transkriptzeile. */
export interface TimedTextCue {
  readonly id: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  /** Sprechername; im WebVTT als Stimme (<v Name>) ausgezeichnet. */
  readonly speaker?: string | undefined;
}

/** Zeile eines gesprochenen Transkripts (Audio-Übersicht, Deep-Dive-Bühne). */
export interface SpokenTranscriptLine {
  readonly id: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly speakerName: string;
  readonly text: string;
}

/** Abschnitt des Video-Transkripts: was gesagt und was gezeigt wird. */
export interface VideoTranscriptEntry {
  readonly id: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly chapter: string | undefined;
  readonly narration: string;
  readonly description: string;
}

/** Sprache der Inhalte; bestimmt nur die Wörter, die die Funktionen selbst einfügen. */
export type MediaTextLanguage = "de" | "en";

interface MediaLabels {
  readonly chart: string;
  readonly points: string;
  readonly source: string;
  readonly chapter: string;
  readonly visual: string;
  readonly transcript: string;
}

const LABELS: Readonly<Record<MediaTextLanguage, MediaLabels>> = {
  de: {
    chart: "Diagramm",
    points: "Punkte auf der Folie",
    source: "Quelle",
    chapter: "Kapitel",
    visual: "Bild",
    transcript: "Transkript"
  },
  en: {
    chart: "Chart",
    points: "Points on the slide",
    source: "Source",
    chapter: "Chapter",
    visual: "Visual",
    transcript: "Transcript"
  }
};

/** Längste Untertitelzeile in Zeichen (zwei Zeilen à 42 Zeichen, BBC/Netflix-Richtwert). */
export const MAX_CAPTION_CHARS = 84;

/** Leerraum zusammenfassen: eine Zeile, keine leeren Zeilen im Cue. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Cue-Text für WebVTT: &, < und > maskieren, eine Zeile. Mit maskiertem > kann der
 * Zeitpfeil im Text nicht mehr vorkommen.
 */
export function escapeVttText(text: string): string {
  return oneLine(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Cue-Kennung und Kopfzeile dürfen weder "-->" noch Zeilenumbrüche enthalten. */
function vttSafeLine(text: string): string {
  return oneLine(text).split("-->").join("->");
}

/** WebVTT-Zeitstempel hh:mm:ss.mmm. */
export function vttTimestamp(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const pad = (n: number, d = 2) => String(n).padStart(d, "0");
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor(safe / 60_000) % 60;
  const seconds = Math.floor(safe / 1000) % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(safe % 1000, 3)}`;
}

/**
 * Gültiges WebVTT aus Cues. Leere Texte und Cues ohne Dauer fallen weg, die übrigen stehen
 * nach Startzeit sortiert. Sprecher werden als Stimme ausgezeichnet.
 */
export function buildWebVtt(cues: readonly TimedTextCue[], title?: string): string {
  const head = title ? `WEBVTT - ${vttSafeLine(title)}` : "WEBVTT";
  const blocks = cues
    .filter((cue) => oneLine(cue.text) !== "" && cue.endMs > cue.startMs)
    .toSorted((a, b) => a.startMs - b.startMs)
    .map((cue) => {
      const voice = cue.speaker ? `<v ${escapeVttText(cue.speaker)}>` : "";
      return `${vttSafeLine(cue.id)}\n${vttTimestamp(cue.startMs)} --> ${vttTimestamp(cue.endMs)}\n${voice}${escapeVttText(cue.text)}`;
    });
  return `${[head, ...blocks].join("\n\n")}\n`;
}

/**
 * Teilt einen Sprechertext in Sätze und fasst kurze Sätze bis maxChars zusammen. Ein einzelner
 * Satz über maxChars wird an Wortgrenzen geteilt, damit jeder Untertitel lesbar bleibt.
 */
export function splitCaptionText(text: string, maxChars = MAX_CAPTION_CHARS): string[] {
  const sentences = oneLine(text)
    .split(/(?<=[.!?…])\s+/)
    .filter((s) => s !== "");
  const pieces: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      pieces.push(sentence);
      continue;
    }
    let line = "";
    for (const word of sentence.split(" ")) {
      if (line && `${line} ${word}`.length > maxChars) {
        pieces.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    pieces.push(line);
  }
  const merged: string[] = [];
  for (const piece of pieces) {
    const last = merged.at(-1);
    if (last !== undefined && `${last} ${piece}`.length <= maxChars) {
      merged[merged.length - 1] = `${last} ${piece}`;
    } else {
      merged.push(piece);
    }
  }
  return merged;
}

/**
 * Verteilt Textstücke über einen Zeitraum, anteilig nach ihrer Länge. Das letzte Stück endet
 * genau am Ende des Zeitraums, damit keine Lücke entsteht.
 */
export function timeCaptionPieces(
  idPrefix: string,
  pieces: readonly string[],
  startMs: number,
  endMs: number,
  speaker?: string
): TimedTextCue[] {
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const span = Math.max(0, endMs - startMs);
  let cursor = startMs;
  return pieces.map((text, index) => {
    const isLast = index === pieces.length - 1;
    const next = isLast ? endMs : cursor + Math.round((span * text.length) / total);
    const cue: TimedTextCue = {
      id: `${idPrefix}-${index + 1}`,
      startMs: cursor,
      endMs: next,
      text,
      ...(speaker ? { speaker } : {})
    };
    cursor = next;
    return cue;
  });
}

/** Untertitel der Video-Übersicht aus dem Sprechertext jeder Folie. */
export function storyboardCaptionCues(storyboard: VideoStoryboard): TimedTextCue[] {
  return storyboard.slides.flatMap((slide) =>
    timeCaptionPieces(
      `cap-${slide.id}`,
      splitCaptionText(slide.spokenNarration),
      slide.startTimeMs,
      slide.endTimeMs
    )
  );
}

/** Alle sichtbaren Inhalte einer Folie als Satzfolge: Beschreibung, Titel, Punkte, Diagramm, Quelle. */
export function describeSlide(slide: VideoSlide, lang: MediaTextLanguage = "de"): string {
  const labels = LABELS[lang];
  const end = (text: string) => (/[.!?…:]$/.test(text) ? text : `${text}.`);
  const parts = [end(oneLine(slide.audioDescription))];
  const heading = slide.subtitle ? `${slide.title} – ${slide.subtitle}` : slide.title;
  parts.push(end(oneLine(heading)));
  parts.push(`${labels.points}: ${slide.bulletPoints.map(oneLine).join("; ")}.`);
  if (slide.chart && slide.chart.data.length > 0) {
    const unit = slide.chart.unit ?? "";
    const values = slide.chart.data.map((d) => `${d.label} ${d.value}${unit}`).join(", ");
    parts.push(`${labels.chart} „${slide.chart.title}“: ${values}.`);
  }
  const citation = slide.citations[0];
  if (citation) parts.push(`${labels.source}: ${citation.sourceTitle}.`);
  return parts.join(" ");
}

/** Beschreibungsspur (WebVTT kind="descriptions"): eine Beschreibung je Folie. */
export function storyboardDescriptionCues(
  storyboard: VideoStoryboard,
  lang: MediaTextLanguage = "de"
): TimedTextCue[] {
  return storyboard.slides.map((slide) => ({
    id: `desc-${slide.id}`,
    startMs: slide.startTimeMs,
    endMs: slide.endTimeMs,
    text: describeSlide(slide, lang)
  }));
}

/** Transkript der Video-Übersicht: je Folie Kapitel, Sprechertext und Bildbeschreibung. */
export function storyboardTranscript(
  storyboard: VideoStoryboard,
  lang: MediaTextLanguage = "de"
): VideoTranscriptEntry[] {
  return storyboard.slides.map((slide) => ({
    id: slide.id,
    startMs: slide.startTimeMs,
    endMs: slide.endTimeMs,
    chapter: storyboard.chapters.find((ch) => ch.slideIds.includes(slide.id))?.title,
    narration: oneLine(slide.spokenNarration),
    description: describeSlide(slide, lang)
  }));
}

/** Gesprochene Transkriptzeilen als Untertitel mit Sprecherstimme. */
export function spokenLinesToCues(lines: readonly SpokenTranscriptLine[]): TimedTextCue[] {
  return lines.map((line) => ({
    id: line.id,
    startMs: line.startMs,
    endMs: line.endMs,
    text: line.text,
    speaker: line.speakerName
  }));
}

/** Zeit für Klartext: m:ss bzw. h:mm:ss. */
export function clockTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

/** Video-Transkript als Klartext zum Herunterladen. */
export function videoTranscriptToText(
  title: string,
  entries: readonly VideoTranscriptEntry[],
  lang: MediaTextLanguage = "de"
): string {
  const labels = LABELS[lang];
  const blocks = entries.map((entry) => {
    const head = `[${clockTime(entry.startMs)}–${clockTime(entry.endMs)}]${
      entry.chapter ? ` ${labels.chapter}: ${entry.chapter}` : ""
    }`;
    return `${head}\n${entry.narration}\n${labels.visual}: ${entry.description}`;
  });
  return `${oneLine(title)} – ${labels.transcript}\n\n${blocks.join("\n\n")}\n`;
}

/** Gesprochenes Transkript als Klartext: Zeit, Sprecher, Text. */
export function spokenTranscriptToText(
  title: string,
  lines: readonly SpokenTranscriptLine[],
  lang: MediaTextLanguage = "de"
): string {
  const body = lines
    .map(
      (line) => `[${clockTime(line.startMs)}] ${oneLine(line.speakerName)}: ${oneLine(line.text)}`
    )
    .join("\n");
  return `${oneLine(title)} – ${LABELS[lang].transcript}\n\n${body}\n`;
}
