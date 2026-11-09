import type {
  ArtifactRow,
  ArtifactStatus,
  ChatRow,
  ChunkRow,
  ChunkVectorRow,
  MessageRow,
  NoteRow,
  ProviderKeyRow,
  ProviderType,
  SourceRow,
  SourceStatus
} from "@notebook-lm/shared";
import type { DatabaseAdapter } from "./core-repository.js";

export class RagRepository {
  constructor(readonly db: DatabaseAdapter) {}

  // ---------------------------------------------------------------------------
  // Sources
  // ---------------------------------------------------------------------------
  async createSource(source: SourceRow): Promise<void> {
    await this.db.run(
      `INSERT INTO sources (
        id, notebook_id, title, original_name, mime_type, source_type,
        byte_size, r2_key, r2_etag, status, error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        source.id,
        source.notebook_id,
        source.title,
        source.original_name,
        source.mime_type,
        source.source_type,
        source.byte_size,
        source.r2_key,
        source.r2_etag,
        source.status,
        source.error_message,
        source.created_at,
        source.updated_at
      ]
    );
  }

  async getSourceById(id: string): Promise<SourceRow | null> {
    return this.db.queryOne<SourceRow>("SELECT * FROM sources WHERE id = ?", [id]);
  }

  async getSourcesByNotebook(notebookId: string): Promise<SourceRow[]> {
    return this.db.query<SourceRow>(
      "SELECT * FROM sources WHERE notebook_id = ? ORDER BY created_at ASC",
      [notebookId]
    );
  }

  async updateSourceStatus(
    id: string,
    status: SourceStatus,
    errorMessage: string | null = null
  ): Promise<void> {
    await this.db.run(
      "UPDATE sources SET status = ?, error_message = ?, updated_at = ? WHERE id = ?",
      [status, errorMessage, Date.now(), id]
    );
  }

  async deleteSource(id: string): Promise<void> {
    await this.db.run("DELETE FROM sources WHERE id = ?", [id]);
  }

  // ---------------------------------------------------------------------------
  // Chunks & Vectors
  // ---------------------------------------------------------------------------
  async insertChunks(chunks: ChunkRow[]): Promise<void> {
    for (const chunk of chunks) {
      await this.db.run(
        `INSERT INTO chunks (
          id, source_id, notebook_id, chunk_index, page_number,
          start_offset, end_offset, text, token_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          chunk.id,
          chunk.source_id,
          chunk.notebook_id,
          chunk.chunk_index,
          chunk.page_number,
          chunk.start_offset,
          chunk.end_offset,
          chunk.text,
          chunk.token_count,
          chunk.created_at
        ]
      );
    }
  }

  async getChunksBySource(sourceId: string): Promise<ChunkRow[]> {
    return this.db.query<ChunkRow>(
      "SELECT * FROM chunks WHERE source_id = ? ORDER BY chunk_index ASC",
      [sourceId]
    );
  }

  async insertChunkVectors(vectors: ChunkVectorRow[]): Promise<void> {
    for (const vec of vectors) {
      await this.db.run(
        `INSERT OR REPLACE INTO chunk_vectors (
          chunk_id, notebook_id, model, dimensions, scale, min_val, max_val, vector, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          vec.chunk_id,
          vec.notebook_id,
          vec.model,
          vec.dimensions,
          vec.scale,
          vec.min_val,
          vec.max_val,
          vec.vector,
          vec.created_at
        ]
      );
    }
  }

  async getChunkVector(chunkId: string): Promise<ChunkVectorRow | null> {
    return this.db.queryOne<ChunkVectorRow>("SELECT * FROM chunk_vectors WHERE chunk_id = ?", [
      chunkId
    ]);
  }

  async getChunkVectorsByNotebook(notebookId: string): Promise<ChunkVectorRow[]> {
    return this.db.query<ChunkVectorRow>("SELECT * FROM chunk_vectors WHERE notebook_id = ?", [
      notebookId
    ]);
  }

  // ---------------------------------------------------------------------------
  // FTS5 Fulltext Search
  // ---------------------------------------------------------------------------
  async searchChunksFts(
    notebookId: string,
    queryText: string,
    limit = 10
  ): Promise<Array<ChunkRow & { rank: number }>> {
    return this.db.query<ChunkRow & { rank: number }>(
      `SELECT c.*, f.rank
       FROM chunks_fts f
       JOIN chunks c ON c.rowid = f.rowid
       WHERE f.text MATCH ? AND c.notebook_id = ?
       ORDER BY f.rank
       LIMIT ?`,
      [queryText, notebookId, limit]
    );
  }

  // ---------------------------------------------------------------------------
  // Chats & Messages
  // ---------------------------------------------------------------------------
  async createChat(chat: ChatRow): Promise<void> {
    await this.db.run(
      `INSERT INTO chats (id, notebook_id, user_id, title, model_used, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        chat.id,
        chat.notebook_id,
        chat.user_id,
        chat.title,
        chat.model_used,
        chat.created_at,
        chat.updated_at
      ]
    );
  }

  async getChatsByNotebook(notebookId: string): Promise<ChatRow[]> {
    return this.db.query<ChatRow>(
      "SELECT * FROM chats WHERE notebook_id = ? ORDER BY updated_at DESC",
      [notebookId]
    );
  }

  async createMessage(msg: MessageRow): Promise<void> {
    await this.db.run(
      `INSERT INTO messages (
        id, chat_id, role, content, citations_json, latency_ms,
        token_usage_json, ai_generated, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        msg.id,
        msg.chat_id,
        msg.role,
        msg.content,
        msg.citations_json,
        msg.latency_ms,
        msg.token_usage_json,
        msg.ai_generated,
        msg.created_at
      ]
    );
  }

  async getMessagesByChat(chatId: string): Promise<MessageRow[]> {
    return this.db.query<MessageRow>(
      "SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC",
      [chatId]
    );
  }

  // ---------------------------------------------------------------------------
  // Studio Artifacts
  // ---------------------------------------------------------------------------
  async createArtifact(artifact: ArtifactRow): Promise<void> {
    await this.db.run(
      `INSERT INTO artifacts (
        id, notebook_id, user_id, type, title, content_json,
        r2_key, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        artifact.id,
        artifact.notebook_id,
        artifact.user_id,
        artifact.type,
        artifact.title,
        artifact.content_json,
        artifact.r2_key,
        artifact.status,
        artifact.created_at,
        artifact.updated_at
      ]
    );
  }

  async getArtifactsByNotebook(notebookId: string): Promise<ArtifactRow[]> {
    return this.db.query<ArtifactRow>(
      "SELECT * FROM artifacts WHERE notebook_id = ? ORDER BY created_at DESC",
      [notebookId]
    );
  }

  async updateArtifact(
    id: string,
    updates: {
      status?: ArtifactStatus;
      content_json?: string | null;
      r2_key?: string | null;
    }
  ): Promise<void> {
    const fields: string[] = ["updated_at = ?"];
    const params: unknown[] = [Date.now()];

    if (updates.status !== undefined) {
      fields.push("status = ?");
      params.push(updates.status);
    }
    if (updates.content_json !== undefined) {
      fields.push("content_json = ?");
      params.push(updates.content_json);
    }
    if (updates.r2_key !== undefined) {
      fields.push("r2_key = ?");
      params.push(updates.r2_key);
    }

    params.push(id);
    await this.db.run(`UPDATE artifacts SET ${fields.join(", ")} WHERE id = ?`, params);
  }

  // ---------------------------------------------------------------------------
  // Collaborative Notes
  // ---------------------------------------------------------------------------
  async createNote(note: NoteRow): Promise<void> {
    await this.db.run(
      `INSERT INTO notes (id, notebook_id, user_id, title, content, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        note.id,
        note.notebook_id,
        note.user_id,
        note.title,
        note.content,
        note.version,
        note.created_at,
        note.updated_at
      ]
    );
  }

  async getNotesByNotebook(notebookId: string): Promise<NoteRow[]> {
    return this.db.query<NoteRow>(
      "SELECT * FROM notes WHERE notebook_id = ? ORDER BY updated_at DESC",
      [notebookId]
    );
  }

  async updateNote(id: string, title: string, content: string, version: number): Promise<void> {
    await this.db.run(
      "UPDATE notes SET title = ?, content = ?, version = ?, updated_at = ? WHERE id = ?",
      [title, content, version, Date.now(), id]
    );
  }

  // ---------------------------------------------------------------------------
  // BYOK Provider Keys
  // ---------------------------------------------------------------------------
  async setProviderKey(key: ProviderKeyRow): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO provider_keys (
        id, user_id, provider, encrypted_key, key_version, last4, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        key.id,
        key.user_id,
        key.provider,
        key.encrypted_key,
        key.key_version,
        key.last4,
        key.created_at,
        key.updated_at
      ]
    );
  }

  async getProviderKey(userId: string, provider: ProviderType): Promise<ProviderKeyRow | null> {
    return this.db.queryOne<ProviderKeyRow>(
      "SELECT * FROM provider_keys WHERE user_id = ? AND provider = ?",
      [userId, provider]
    );
  }

  async deleteProviderKey(userId: string, provider: ProviderType): Promise<void> {
    await this.db.run("DELETE FROM provider_keys WHERE user_id = ? AND provider = ?", [
      userId,
      provider
    ]);
  }

  async listProviderKeysByUser(userId: string): Promise<ProviderKeyRow[]> {
    return this.db.query<ProviderKeyRow>(
      "SELECT * FROM provider_keys WHERE user_id = ? ORDER BY provider ASC",
      [userId]
    );
  }

  async getAllProviderKeys(): Promise<ProviderKeyRow[]> {
    return this.db.query<ProviderKeyRow>("SELECT * FROM provider_keys ORDER BY created_at ASC");
  }
}
