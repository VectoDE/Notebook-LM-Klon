/**
 * Quellen für die Audio-Übersicht (Issue #240).
 *
 * Die Demo-Arbeitsfläche hat nur kurze Quellentexte. Für ein Skript mit echten Zitaten
 * nutzt sie die Abschnitte des Demo-Notebooks „Cloudflare Edge Architecture“ (deutsch).
 */
import {
  type AudioOverviewSourceInput,
  CLOUDFLARE_ARCH_DEMO_NOTEBOOK,
  type DemoNotebookDefinition
} from "@notebook-lm/shared";

/** Demo-Notebook in Eingaben für den Skriptgenerator umwandeln. */
export function audioOverviewSourcesFromDemo(
  notebook: DemoNotebookDefinition = CLOUDFLARE_ARCH_DEMO_NOTEBOOK,
  lang = "de"
): AudioOverviewSourceInput[] {
  return notebook.sources.map((source) => ({
    id: source.id,
    title: source.title,
    lang,
    chunks: source.chunks.map((chunk) => ({
      id: chunk.id,
      text: chunk.text,
      pageNumber: chunk.pageNumber ?? null
    }))
  }));
}
