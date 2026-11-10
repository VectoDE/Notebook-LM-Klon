/**
 * Idempotent D1 Demo Seeder for RelationNotes.
 *
 * Implements Sub-Issue #109 (Issue #21, Decisions #45, #63, #69).
 * Seeds the two showcase demo notebooks:
 * 1. RelationFlow & KI im Mittelstand (DSGVO, EU AI Act & RAG)
 * 2. Cloudflare Edge Architecture & High-Craft Web Engineering
 *
 * Idempotently inserts:
 * - Workspaces (DEMO_WORKSPACE_ID) & membership
 * - Notebooks (RELATIONFLOW_NOTEBOOK_ID, CLOUDFLARE_ARCH_NOTEBOOK_ID)
 * - Sources & Chunks
 * - Quantized int8 vectors with min/max scale
 * - Chats, Messages & Citations
 * - Studio Artifacts (Audio, Video, Mindmap, Flashcards, Quiz, Briefing)
 * - Collaborative Notes
 */

import {
  ALL_DEMO_NOTEBOOKS,
  generateDeterministicEmbedding,
  quantizeFloat32ToInt8
} from "@notebook-lm/shared";
import type { DatabaseAdapter } from "./core-repository.js";

export const DEMO_SYSTEM_USER_ID = "usr_system_demo";
export const DEMO_SYSTEM_EMAIL = "system-demo@relationnotes.local";
export const DEMO_SYSTEM_DISPLAY_NAME = "RelationNotes Demo System";

export const DEMO_WORKSPACE_ID = "ws_demo_relationflow";
export const DEMO_WORKSPACE_NAME = "RelationFlow & KI im Mittelstand";

export interface DemoSeedMetrics {
  readonly seededWorkspaces: number;
  readonly seededNotebooks: number;
  readonly seededSources: number;
  readonly seededChunks: number;
  readonly seededVectors: number;
  readonly seededChats: number;
  readonly seededMessages: number;
  readonly seededArtifacts: number;
  readonly seededNotes: number;
}

/**
 * Idempotently seeds demo notebooks into D1.
 * If targetUserId is provided, grants the user viewer or editor access
 * to the demo workspace and notebooks.
 */
export async function seedDemoNotebooks(
  db: DatabaseAdapter,
  options?: {
    targetUserId?: string | undefined;
    targetWorkspaceId?: string | undefined;
    grantAccessRole?: "viewer" | "editor" | undefined;
    now?: number | undefined;
  }
): Promise<DemoSeedMetrics> {
  const now = options?.now ?? Date.now();
  let seededWorkspaces = 0;
  let seededNotebooks = 0;
  let seededSources = 0;
  let seededChunks = 0;
  let seededVectors = 0;
  let seededChats = 0;
  let seededMessages = 0;
  let seededArtifacts = 0;
  let seededNotes = 0;

  // 1. Ensure system demo user exists
  await db.run(
    `INSERT OR IGNORE INTO users (id, email, display_name, locale, is_guest, created_at, expires_at, deleted_at)
     VALUES (?, ?, ?, 'de', 0, ?, NULL, NULL)`,
    [DEMO_SYSTEM_USER_ID, DEMO_SYSTEM_EMAIL, DEMO_SYSTEM_DISPLAY_NAME, now]
  );

  // 2. Ensure global demo workspace exists
  const workspaceId = options?.targetWorkspaceId ?? DEMO_WORKSPACE_ID;
  const existingWs = await db.queryOne<{ id: string }>("SELECT id FROM workspaces WHERE id = ?", [
    workspaceId
  ]);
  if (!existingWs) {
    await db.run(
      `INSERT INTO workspaces (id, name, owner_id, created_at)
       VALUES (?, ?, ?, ?)`,
      [workspaceId, DEMO_WORKSPACE_NAME, DEMO_SYSTEM_USER_ID, now]
    );
    seededWorkspaces++;
  }

  // 3. If targetUserId is given, ensure user exists and grant membership in workspace
  if (options?.targetUserId) {
    const existingTargetUser = await db.queryOne<{ id: string }>(
      "SELECT id FROM users WHERE id = ?",
      [options.targetUserId]
    );
    if (!existingTargetUser) {
      await db.run(
        `INSERT OR IGNORE INTO users (id, email, display_name, locale, is_guest, created_at, expires_at, deleted_at)
         VALUES (?, NULL, 'Nutzer', 'de', 0, ?, NULL, NULL)`,
        [options.targetUserId, now]
      );
    }

    const role = options.grantAccessRole ? options.grantAccessRole : "viewer";
    await db.run(
      `INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, created_at)
       VALUES (?, ?, ?, ?)`,
      [workspaceId, options.targetUserId, role, now]
    );
  }

  // 4. Seed each demo notebook idempotently (if RAG schema tables exist)
  const sourcesTable = await db.queryOne<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sources'"
  );
  if (!sourcesTable) {
    // Only core schema is loaded, so workspaces/users are seeded
    return {
      seededWorkspaces,
      seededNotebooks,
      seededSources,
      seededChunks,
      seededVectors,
      seededChats,
      seededMessages,
      seededArtifacts,
      seededNotes
    };
  }

  for (const def of ALL_DEMO_NOTEBOOKS) {
    const existingNb = await db.queryOne<{ id: string }>("SELECT id FROM notebooks WHERE id = ?", [
      def.id
    ]);

    if (!existingNb) {
      await db.run(
        `INSERT INTO notebooks (id, workspace_id, title, emoji, created_by, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
        [def.id, workspaceId, def.title, def.emoji, DEMO_SYSTEM_USER_ID, now, now]
      );
      seededNotebooks++;
    }

    // Seed sources
    for (const src of def.sources) {
      const existingSrc = await db.queryOne<{ id: string }>("SELECT id FROM sources WHERE id = ?", [
        src.id
      ]);
      if (!existingSrc) {
        await db.run(
          `INSERT INTO sources (
            id, notebook_id, title, original_name, mime_type, source_type,
            byte_size, r2_key, r2_etag, status, error_message, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'ready', NULL, ?, ?)`,
          [
            src.id,
            def.id,
            src.title,
            src.originalName,
            src.mimeType,
            src.sourceType,
            src.byteSize,
            now,
            now
          ]
        );
        seededSources++;
      }

      // Seed chunks and vectors
      for (const chk of src.chunks) {
        const existingChk = await db.queryOne<{ id: string }>(
          "SELECT id FROM chunks WHERE id = ?",
          [chk.id]
        );
        if (!existingChk) {
          const pageNum = chk.pageNumber;
          const startOff = chk.startOffset;
          const endOff = chk.endOffset;

          await db.run(
            `INSERT INTO chunks (
              id, source_id, notebook_id, chunk_index, page_number,
              start_offset, end_offset, text, token_count, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              chk.id,
              src.id,
              def.id,
              chk.chunkIndex,
              pageNum,
              startOff,
              endOff,
              chk.text,
              chk.tokenCount,
              now
            ]
          );
          seededChunks++;

          // Insert or replace vector
          const rawEmbedding = generateDeterministicEmbedding(chk.text, 768);

          const quantized = quantizeFloat32ToInt8(rawEmbedding);
          const vectorBlob = new Uint8Array(quantized.quantized.buffer);

          await db.run(
            `INSERT OR REPLACE INTO chunk_vectors (
              chunk_id, notebook_id, model, dimensions, scale, min_val, max_val, vector, created_at
            ) VALUES (?, ?, 'text-embedding-3-small', ?, ?, -1.0, 1.0, ?, ?)`,
            [chk.id, def.id, rawEmbedding.length, quantized.scale, vectorBlob, now]
          );
          seededVectors++;
        }
      }
    }

    // Seed chats and messages
    for (const chat of def.chats) {
      const existingChat = await db.queryOne<{ id: string }>("SELECT id FROM chats WHERE id = ?", [
        chat.id
      ]);
      if (!existingChat) {
        await db.run(
          `INSERT INTO chats (id, notebook_id, user_id, title, model_used, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [chat.id, def.id, DEMO_SYSTEM_USER_ID, chat.title, chat.modelUsed, now, now]
        );
        seededChats++;
      }

      for (const msg of chat.messages) {
        const existingMsg = await db.queryOne<{ id: string }>(
          "SELECT id FROM messages WHERE id = ?",
          [msg.id]
        );
        if (!existingMsg) {
          const citationsJson = msg.citations ? JSON.stringify(msg.citations) : null;
          await db.run(
            `INSERT INTO messages (
              id, chat_id, role, content, citations_json, latency_ms,
              token_usage_json, ai_generated, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
            [
              msg.id,
              chat.id,
              msg.role,
              msg.content,
              citationsJson,
              msg.latencyMs ?? null,
              msg.aiGenerated ? 1 : 0,
              now
            ]
          );
          seededMessages++;
        }
      }
    }

    // Seed artifacts
    for (const art of def.artifacts) {
      const existingArt = await db.queryOne<{ id: string }>(
        "SELECT id FROM artifacts WHERE id = ?",
        [art.id]
      );
      if (!existingArt) {
        await db.run(
          `INSERT INTO artifacts (
            id, notebook_id, user_id, type, title, content_json,
            r2_key, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            art.id,
            def.id,
            DEMO_SYSTEM_USER_ID,
            art.type,
            art.title,
            art.contentJson,
            art.r2Key ?? null,
            art.status,
            now,
            now
          ]
        );
        seededArtifacts++;
      }
    }

    // Seed notes
    for (const note of def.notes) {
      const existingNote = await db.queryOne<{ id: string }>("SELECT id FROM notes WHERE id = ?", [
        note.id
      ]);
      if (!existingNote) {
        await db.run(
          `INSERT INTO notes (
            id, notebook_id, user_id, title, content, version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [note.id, def.id, DEMO_SYSTEM_USER_ID, note.title, note.content, note.version, now, now]
        );
        seededNotes++;
      }
    }
  }

  return {
    seededWorkspaces,
    seededNotebooks,
    seededSources,
    seededChunks,
    seededVectors,
    seededChats,
    seededMessages,
    seededArtifacts,
    seededNotes
  };
}
