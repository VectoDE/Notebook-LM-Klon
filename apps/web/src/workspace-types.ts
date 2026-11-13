export interface WorkspaceSource {
  readonly id: string;
  readonly title: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly chunksCount?: number | undefined;
  readonly isSelected?: boolean | undefined;
  readonly rawText?: string | undefined;
  /**
   * Sprache von Titel und Volltext (BCP 47, z. B. "en"). Weicht sie von der Oberfläche ab,
   * zeichnen die Bereiche den Inhalt mit lang aus (WCAG 3.1.2, Issue #323).
   */
  readonly lang?: string | undefined;
  /**
   * Stand der lokalen Verarbeitung (Issue #154). Fehlt der Wert, gilt die Quelle als bereit.
   */
  readonly status?: SourceStatus | undefined;
  /** Fortschritt 0–100 während "processing". */
  readonly progress?: number | undefined;
  /** Aktuelle Phase während "processing". */
  readonly stage?: SourceStage | undefined;
  /** Fehlerart bei "error". */
  readonly errorCode?: SourceErrorCode | undefined;
}

export type SourceStatus = "processing" | "ready" | "error";
export type SourceStage = "reading" | "pdf" | "docx" | "ocr" | "chunking";
export type SourceErrorCode = "unsupported" | "unreadable" | "too_large" | "failed";

/**
 * Fokusziel eines Bereichs (Issue #323): sitzt auf der benannten Region des Panels, nicht
 * auf dem Layout-Wrapper.
 */
export interface PanelFocusAttributes {
  readonly "data-panel": string;
  readonly tabIndex: number;
}

export interface CitationLocation {
  readonly sourceId: string;
  readonly chunkId?: string | undefined;
  readonly quote?: string | undefined;
  readonly page?: number | null | undefined;
  readonly startOffset?: number | null | undefined;
  readonly endOffset?: number | null | undefined;
}
