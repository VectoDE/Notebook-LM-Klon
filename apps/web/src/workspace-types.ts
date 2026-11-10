export interface WorkspaceSource {
  readonly id: string;
  readonly title: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly chunksCount?: number | undefined;
  readonly isSelected?: boolean | undefined;
  readonly rawText?: string | undefined;
}

export interface CitationLocation {
  readonly sourceId: string;
  readonly chunkId?: string | undefined;
  readonly quote?: string | undefined;
  readonly page?: number | null | undefined;
  readonly startOffset?: number | null | undefined;
  readonly endOffset?: number | null | undefined;
}
