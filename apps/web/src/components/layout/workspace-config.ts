import type { StudioTool } from "@/components/panels/StudioPanel.js";
import type { AppearanceControlsProps } from "@/components/ui/AppearanceControls.js";
import type { IconName } from "@/components/ui/Icon.js";

/** Unter 600 px: Logo, Titel und Menü-Knopf oben, Reiterleiste unten. */
export const NARROW_HEADER_QUERY = "(max-width: 599.98px)";

/**
 * Unter 900 px ist nur ein Bereich sichtbar: die Reiter schalten um. Ab 900 px stehen alle
 * Spalten nebeneinander und sind selbst die Navigation (Issue #325).
 */
export const SINGLE_PANEL_QUERY = "(max-width: 899.98px)";

/** Bereiche; graph teilt sich ab 900 px die mittlere Spalte mit dem Chat (Issue #327). */
export type PanelTab = "sources" | "chat" | "studio" | "graph";
export type Popover = "appearance" | "account";

/**
 * Bereiche des Arbeitsbereichs: Schlüssel im Sprachkatalog für den kurzen Namen und den
 * vollen Namen für Screenreader (beginnt mit dem sichtbaren Namen).
 */
export const PANEL_TABS: readonly {
  readonly id: PanelTab;
  readonly labelKey: string;
  readonly ariaKey: string;
  /** Sprunglink zur Spalte; der Graph hat keine eigene Spalte und keinen Sprunglink. */
  readonly skipKey?: string | undefined;
  readonly icon: IconName;
}[] = [
  {
    id: "sources",
    labelKey: "navSources",
    ariaKey: "navSources",
    skipKey: "skipToSources",
    icon: "sources"
  },
  { id: "chat", labelKey: "navChat", ariaKey: "navChatAria", skipKey: "skipToChat", icon: "chat" },
  {
    id: "studio",
    labelKey: "navStudio",
    ariaKey: "navStudioAria",
    skipKey: "skipToStudio",
    icon: "studio"
  },
  { id: "graph", labelKey: "navGraph", ariaKey: "navGraphAria", icon: "graph" }
];

/**
 * Werkzeuge in der Symbolleiste der eingeklappten Studio-Spalte. Der Wissensgraph steht wie
 * im Studio nach der Mindmap; er öffnet in der mittleren Spalte (Issue #327, #335).
 */
export const RAIL_TOOLS: readonly {
  readonly tool: Exclude<StudioTool, "overview" | "briefing"> | "graph";
  readonly icon: IconName;
  readonly labelKey: string;
}[] = [
  { tool: "audio", icon: "audio", labelKey: "studioAudioCard" },
  { tool: "video", icon: "video", labelKey: "studioVideoCard" },
  { tool: "mindmap", icon: "mindmap", labelKey: "toolMindmapTitle" },
  { tool: "graph", icon: "graph", labelKey: "toolGraphTitle" },
  { tool: "flashcards", icon: "cards", labelKey: "toolCardsTitle" },
  { tool: "quiz", icon: "quiz", labelKey: "toolQuizTitle" }
];

/** id der Spalteninhalte: Ziel von aria-controls und der Sprunglinks. */
export const COLUMN_IDS: Readonly<Record<PanelTab, string>> = {
  sources: "sources-column",
  chat: "chat-column",
  studio: "studio-column",
  graph: "chat-column"
};

/** Einstellungen der Darstellung, die Kopfzeile und Menü-Sheet an AppearanceControls geben. */
export type AppearanceProps = Omit<AppearanceControlsProps, "idPrefix">;
