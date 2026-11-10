/**
 * Types and models for seeded demo notebooks, sources, chunks, vectors,
 * chats, messages, citations, and studio artifacts.
 *
 * Implements Sub-Issues #107, #108, #109 (Decision #45, #63, #69).
 */

import type { ArtifactType, MessageRole, SourceType } from "../models.d.js";

export interface DemoSourceDefinition {
  readonly id: string;
  readonly title: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sourceType: SourceType;
  readonly byteSize: number;
  readonly chunks: readonly DemoChunkDefinition[];
}

export interface DemoChunkDefinition {
  readonly id: string;
  readonly chunkIndex: number;
  readonly pageNumber?: number | null;
  readonly startOffset?: number | null;
  readonly endOffset?: number | null;
  readonly text: string;
  readonly tokenCount: number;
  /**
   * Optional custom 768d float32 vector embedding before quantization.
   * If omitted, a deterministic high-dimensional hash embedding is computed.
   */
  readonly embedding?: readonly number[];
}

export interface DemoMessageCitation {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly pageNumber?: number | null;
  readonly quote?: string;
}

export interface DemoMessageDefinition {
  readonly id: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly citations?: readonly DemoMessageCitation[];
  readonly latencyMs?: number;
  readonly aiGenerated?: boolean;
}

export interface DemoChatDefinition {
  readonly id: string;
  readonly title: string;
  readonly modelUsed: string;
  readonly messages: readonly DemoMessageDefinition[];
}

export interface DemoArtifactDefinition {
  readonly id: string;
  readonly type: ArtifactType;
  readonly title: string;
  readonly contentJson: string;
  readonly r2Key?: string | null;
  readonly status: ArtifactStatus;
}

export interface DemoNoteDefinition {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly version: number;
}

export interface DemoNotebookDefinition {
  readonly id: string;
  readonly title: string;
  readonly emoji: string;
  readonly description: string;
  readonly sources: readonly DemoSourceDefinition[];
  readonly chats: readonly DemoChatDefinition[];
  readonly artifacts: readonly DemoArtifactDefinition[];
  readonly notes: readonly DemoNoteDefinition[];
}
