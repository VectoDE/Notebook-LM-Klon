import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { CoreRepository, type DatabaseAdapter } from "../core-repository.js";
import { RagRepository } from "../rag-repository.js";

function createSqliteAdapter(): { adapter: DatabaseAdapter; close: () => void } {
  const db = new DatabaseSync(":memory:");
  const m1Path = resolve(process.cwd(), "apps/worker/migrations/0001_initial_core.sql");
  const m2Path = resolve(process.cwd(), "apps/worker/migrations/0002_rag_and_studio.sql");

  db.exec(readFileSync(m1Path, "utf-8"));
  db.exec(readFileSync(m2Path, "utf-8"));

  const adapter: DatabaseAdapter = {
    async exec(sqlStr: string): Promise<void> {
      db.exec(sqlStr);
    },
    async query<T>(sqlStr: string, params: unknown[] = []): Promise<T[]> {
      const stmt = db.prepare(sqlStr);
      return stmt.all(...(params as (string | number | bigint | null)[])) as T[];
    },
    async queryOne<T>(sqlStr: string, params: unknown[] = []): Promise<T | null> {
      const stmt = db.prepare(sqlStr);
      const row = stmt.get(...(params as (string | number | bigint | null)[]));
      return (row as T) ?? null;
    },
    async run(sqlStr: string, params: unknown[] = []): Promise<{ changes: number }> {
      const stmt = db.prepare(sqlStr);
      const info = stmt.run(...(params as (string | number | bigint | null)[]));
      return { changes: Number(info.changes) };
    }
  };

  return { adapter, close: () => db.close() };
}

describe("0002_rag_and_studio.sql D1 Migration & RagRepository", () => {
  it("creates sources, chunks, and chunk_vectors with cascade delete (Sub-Issue #80)", async () => {
    const { adapter, close } = createSqliteAdapter();
    const core = new CoreRepository(adapter);
    const rag = new RagRepository(adapter);

    const now = Date.now();
    await core.createUser({
      id: "usr_01",
      email: "user@example.com",
      display_name: "Test User",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });
    await core.createWorkspace({
      id: "ws_01",
      name: "Workspace 1",
      owner_id: "usr_01",
      created_at: now
    });
    await core.createNotebook({
      id: "nb_01",
      workspace_id: "ws_01",
      title: "RAG Notebook",
      emoji: "book",
      created_by: "usr_01",
      created_at: now,
      updated_at: now,
      expires_at: null
    });

    // Create source with valid source_type and status
    await rag.createSource({
      id: "src_01",
      notebook_id: "nb_01",
      title: "Klimabericht",
      original_name: "report.pdf",
      mime_type: "application/pdf",
      source_type: "pdf",
      byte_size: 1048576,
      r2_key: "sources/src_01/report.pdf",
      r2_etag: "etag_123",
      status: "uploading",
      error_message: null,
      created_at: now,
      updated_at: now
    });

    const src = await rag.getSourceById("src_01");
    expect(src).not.toBeNull();
    expect(src?.title).toBe("Klimabericht");

    // Update status
    await rag.updateSourceStatus("src_01", "ready");
    const updatedSrc = await rag.getSourceById("src_01");
    expect(updatedSrc?.status).toBe("ready");

    const sources = await rag.getSourcesByNotebook("nb_01");
    expect(sources.length).toBe(1);

    // Insert Chunks
    await rag.insertChunks([
      {
        id: "chk_01",
        source_id: "src_01",
        notebook_id: "nb_01",
        chunk_index: 0,
        page_number: 1,
        start_offset: 0,
        end_offset: 120,
        text: "Die Energiewende schreitet voran und benötigt moderne Netze.",
        token_count: 10,
        created_at: now
      },
      {
        id: "chk_02",
        source_id: "src_01",
        notebook_id: "nb_01",
        chunk_index: 1,
        page_number: 2,
        start_offset: 121,
        end_offset: 250,
        text: "Photovoltaik und Windkraft sind zentrale Säulen der Stromerzeugung.",
        token_count: 12,
        created_at: now
      }
    ]);

    const chunks = await rag.getChunksBySource("src_01");
    expect(chunks.length).toBe(2);

    // Insert int8 Quantized Vector (768 bytes)
    const vecBytes = new Uint8Array(768);
    vecBytes[0] = 42;
    vecBytes[767] = 99;

    await rag.insertChunkVectors([
      {
        chunk_id: "chk_01",
        notebook_id: "nb_01",
        model: "text-embedding-3-small",
        dimensions: 768,
        scale: 0.05,
        min_val: -1.0,
        max_val: 1.0,
        vector: vecBytes,
        created_at: now
      }
    ]);

    const retrievedVec = await rag.getChunkVector("chk_01");
    expect(retrievedVec).not.toBeNull();
    expect(retrievedVec?.dimensions).toBe(768);
    expect(retrievedVec?.scale).toBe(0.05);

    const nbVectors = await rag.getChunkVectorsByNotebook("nb_01");
    expect(nbVectors.length).toBe(1);

    // Test Cascade Deletion on Source: deleting source must cascade-delete chunks & vectors
    await rag.deleteSource("src_01");
    expect(await rag.getSourceById("src_01")).toBeNull();
    expect((await rag.getChunksBySource("src_01")).length).toBe(0);
    expect(await rag.getChunkVector("chk_01")).toBeNull();

    close();
  });

  it("maintains chunks_fts FTS5 synchronization via triggers (Sub-Issue #81)", async () => {
    const { adapter, close } = createSqliteAdapter();
    const core = new CoreRepository(adapter);
    const rag = new RagRepository(adapter);

    const now = Date.now();
    await core.createUser({
      id: "usr_02",
      email: "fts@example.com",
      display_name: "FTS User",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });
    await core.createWorkspace({
      id: "ws_02",
      name: "FTS Workspace",
      owner_id: "usr_02",
      created_at: now
    });
    await core.createNotebook({
      id: "nb_02",
      workspace_id: "ws_02",
      title: "FTS Notebook",
      emoji: "search",
      created_by: "usr_02",
      created_at: now,
      updated_at: now,
      expires_at: null
    });
    await rag.createSource({
      id: "src_02",
      notebook_id: "nb_02",
      title: "Doc",
      original_name: "doc.txt",
      mime_type: "text/plain",
      source_type: "txt",
      byte_size: 256,
      r2_key: null,
      r2_etag: null,
      status: "ready",
      error_message: null,
      created_at: now,
      updated_at: now
    });

    // 1. INSERT Trigger Test
    await rag.insertChunks([
      {
        id: "chk_fts_1",
        source_id: "src_02",
        notebook_id: "nb_02",
        chunk_index: 0,
        page_number: 1,
        start_offset: 0,
        end_offset: 50,
        text: "Künstliche Intelligenz revolutioniert den IT-Dienstleistungssektor.",
        token_count: 8,
        created_at: now
      },
      {
        id: "chk_fts_2",
        source_id: "src_02",
        notebook_id: "nb_02",
        chunk_index: 1,
        page_number: 1,
        start_offset: 51,
        end_offset: 100,
        text: "Volltextsuche mit SQLite FTS5 liefert schnelle BM25 Ergebnisse.",
        token_count: 8,
        created_at: now
      }
    ]);

    const results1 = await rag.searchChunksFts("nb_02", "Intelligenz");
    expect(results1.length).toBe(1);
    expect(results1[0]?.id).toBe("chk_fts_1");

    const results2 = await rag.searchChunksFts("nb_02", "SQLite");
    expect(results2.length).toBe(1);
    expect(results2[0]?.id).toBe("chk_fts_2");

    // 2. UPDATE Trigger Test
    await adapter.run("UPDATE chunks SET text = ? WHERE id = ?", [
      "Quantencomputing und moderne Kryptographie.",
      "chk_fts_1"
    ]);
    const oldQuery = await rag.searchChunksFts("nb_02", "Intelligenz");
    expect(oldQuery.length).toBe(0);

    const newQuery = await rag.searchChunksFts("nb_02", "Quantencomputing");
    expect(newQuery.length).toBe(1);
    expect(newQuery[0]?.id).toBe("chk_fts_1");

    // 3. DELETE Trigger Test (Cascade from Source)
    await rag.deleteSource("src_02");
    const afterDelete = await rag.searchChunksFts("nb_02", "Quantencomputing");
    expect(afterDelete.length).toBe(0);

    close();
  });

  it("handles chats, messages, artifacts, notes, and provider_keys (Sub-Issue #82)", async () => {
    const { adapter, close } = createSqliteAdapter();
    const core = new CoreRepository(adapter);
    const rag = new RagRepository(adapter);

    const now = Date.now();
    await core.createUser({
      id: "usr_03",
      email: "studio@example.com",
      display_name: "Studio User",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });
    await core.createWorkspace({
      id: "ws_03",
      name: "Studio Workspace",
      owner_id: "usr_03",
      created_at: now
    });
    await core.createNotebook({
      id: "nb_03",
      workspace_id: "ws_03",
      title: "Studio Notebook",
      emoji: "studio",
      created_by: "usr_03",
      created_at: now,
      updated_at: now,
      expires_at: null
    });

    // 1. Chats & Messages
    await rag.createChat({
      id: "chat_01",
      notebook_id: "nb_03",
      user_id: "usr_03",
      title: "Diskussion zu Solarzellen",
      model_used: "gemini-2.5-flash",
      created_at: now,
      updated_at: now
    });

    const chats = await rag.getChatsByNotebook("nb_03");
    expect(chats.length).toBe(1);
    expect(chats[0]?.title).toBe("Diskussion zu Solarzellen");

    const citations = JSON.stringify([
      { chunk_id: "chk_01", source_id: "src_01", page_number: 1, quote: "Photovoltaik" }
    ]);
    const tokenUsage = JSON.stringify({ prompt: 150, completion: 45, total: 195 });

    await rag.createMessage({
      id: "msg_01",
      chat_id: "chat_01",
      role: "user",
      content: "Wie hoch ist der Wirkungsgrad von Perowskit-Solarzellen?",
      citations_json: null,
      latency_ms: null,
      token_usage_json: null,
      ai_generated: 0,
      created_at: now
    });

    await rag.createMessage({
      id: "msg_02",
      chat_id: "chat_01",
      role: "assistant",
      content: "Der Wirkungsgrad liegt im Labor bereits über 33%.",
      citations_json: citations,
      latency_ms: 320,
      token_usage_json: tokenUsage,
      ai_generated: 1,
      created_at: now + 500
    });

    const messages = await rag.getMessagesByChat("chat_01");
    expect(messages.length).toBe(2);
    expect(messages[1]?.ai_generated).toBe(1);
    expect(messages[1]?.citations_json).toBe(citations);

    // 2. Artifacts (Studio tools)
    await rag.createArtifact({
      id: "art_01",
      notebook_id: "nb_03",
      user_id: "usr_03",
      type: "audio",
      title: "Audio Overview (Deep Dive Podcast)",
      content_json: JSON.stringify({ duration_seconds: 180 }),
      r2_key: "artifacts/art_01.mp3",
      status: "generating",
      created_at: now,
      updated_at: now
    });

    let artifacts = await rag.getArtifactsByNotebook("nb_03");
    expect(artifacts.length).toBe(1);
    expect(artifacts[0]?.type).toBe("audio");
    expect(artifacts[0]?.status).toBe("generating");

    await rag.updateArtifact("art_01", {
      status: "ready",
      content_json: JSON.stringify({ duration_seconds: 180, quality: "high" }),
      r2_key: "artifacts/art_01_final.mp3"
    });
    artifacts = await rag.getArtifactsByNotebook("nb_03");
    expect(artifacts[0]?.status).toBe("ready");
    expect(artifacts[0]?.r2_key).toBe("artifacts/art_01_final.mp3");
    expect(artifacts[0]?.content_json).toContain("high");

    // 3. Notes
    await rag.createNote({
      id: "note_01",
      notebook_id: "nb_03",
      user_id: "usr_03",
      title: "Wichtige Punkte",
      content: "Netzausbau beschleunigen.",
      version: 1,
      created_at: now,
      updated_at: now
    });

    const notes = await rag.getNotesByNotebook("nb_03");
    expect(notes.length).toBe(1);
    expect(notes[0]?.title).toBe("Wichtige Punkte");

    await rag.updateNote("note_01", "Wichtige Punkte v2", "Netzausbau und Speicher.", 2);
    const updatedNotes = await rag.getNotesByNotebook("nb_03");
    expect(updatedNotes[0]?.version).toBe(2);
    expect(updatedNotes[0]?.content).toBe("Netzausbau und Speicher.");

    // 4. Provider Keys (BYOK)
    await rag.setProviderKey({
      id: "pk_01",
      user_id: "usr_03",
      provider: "anthropic",
      encrypted_key: "enc_blob_hex_value",
      key_version: 1,
      last4: "9876",
      created_at: now,
      updated_at: now
    });

    const key = await rag.getProviderKey("usr_03", "anthropic");
    expect(key).not.toBeNull();
    expect(key?.last4).toBe("9876");

    await rag.deleteProviderKey("usr_03", "anthropic");
    expect(await rag.getProviderKey("usr_03", "anthropic")).toBeNull();

    // 5. Cascade delete notebook cascades all studio entities
    await adapter.run("DELETE FROM notebooks WHERE id = ?", ["nb_03"]);
    expect((await rag.getChatsByNotebook("nb_03")).length).toBe(0);
    expect((await rag.getArtifactsByNotebook("nb_03")).length).toBe(0);
    expect((await rag.getNotesByNotebook("nb_03")).length).toBe(0);

    close();
  });
});
