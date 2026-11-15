/**
 * Downloads gesprochener Transkripte (Issue #350). Eigenes Modul, damit die Bühne es erst
 * beim Klick nachlädt und das Startpaket klein bleibt (Lighthouse-Budget).
 */
import {
  type MediaTextLanguage,
  type SpokenTranscriptLine,
  buildWebVtt,
  spokenLinesToCues,
  spokenTranscriptToText,
  videoTranscriptToText
} from "@notebook-lm/shared";
import { triggerBrowserDownload } from "./artifact-exporters.js";

export type SpokenTranscriptFormat = "txt" | "vtt";

/** Klartext-Transkript der Video-Übersicht, erst beim Download geladen. */
export const videoTranscriptText = videoTranscriptToText;

/** Dateiname, Inhalt und MIME-Typ eines Transkript-Downloads. */
export function spokenTranscriptFile(
  format: SpokenTranscriptFormat,
  title: string,
  lines: readonly SpokenTranscriptLine[],
  lang: MediaTextLanguage
): { readonly filename: string; readonly content: string; readonly mimeType: string } {
  return format === "txt"
    ? {
        filename: `${title}_transkript.txt`,
        content: spokenTranscriptToText(title, lines, lang),
        mimeType: "text/plain;charset=utf-8"
      }
    : {
        filename: `${title}_untertitel.vtt`,
        content: buildWebVtt(spokenLinesToCues(lines), title),
        mimeType: "text/vtt"
      };
}

export function downloadSpokenTranscript(
  format: SpokenTranscriptFormat,
  title: string,
  lines: readonly SpokenTranscriptLine[],
  lang: MediaTextLanguage
): void {
  const file = spokenTranscriptFile(format, title, lines, lang);
  triggerBrowserDownload(file.filename, file.content, file.mimeType);
}
