/**
 * Demo Dataset: Cloudflare Edge Architecture & High-Craft Web Engineering
 * Deep-dive technical showcase notebook for the architecture of RelationNotes.
 *
 * Implements Sub-Issue #108 (Issue #21, Decisions #45, #63).
 * Contains:
 * - 4 detailed technical architectural sources:
 *   1. Cloudflare Single Worker & Durable Objects Hibernation
 *   2. D1 int8 Vector & FTS5 Hybrid Search (Reciprocal Rank Fusion)
 *   3. Dual-Runtime Node.js/Docker & Local SQLite
 *   4. WCAG 2.2 AAA Accessibility & High-Craft Web UI
 * - Pre-calculated chunks with character offsets
 * - Pre-calculated citations and chat history
 * - All 6 studio artifacts (Audio Overview, Video Storyboard, Mindmap, Flashcards, Quiz, Briefing)
 * - Architecture notes
 */

import type { DemoNotebookDefinition } from "./demo-types.d.js";

export const CLOUDFLARE_ARCH_NOTEBOOK_ID = "nb_demo_cloudflare_architecture";

export const CLOUDFLARE_ARCH_DEMO_NOTEBOOK: DemoNotebookDefinition = {
  id: CLOUDFLARE_ARCH_NOTEBOOK_ID,
  title: "Cloudflare Edge Architecture & High-Craft Web Engineering",
  emoji: "zap",
  description:
    "Technisches Deep-Dive-Notebook: Cloudflare Single Worker, Durable Objects Hibernation, D1 int8 Vektor & FTS5 Hybrid Search, Dual-Runtime Node.js und WCAG 2.2 AAA Barrierefreiheit.",
  sources: [
    {
      id: "src_cf_01_worker_do",
      title: "Cloudflare Single Worker & Hibernating Durable Objects",
      originalName: "Cloudflare_Worker_DO_Architecture.md",
      mimeType: "text/markdown",
      sourceType: "md",
      byteSize: 125_400,
      chunks: [
        {
          id: "chk_cf_01_01",
          chunkIndex: 0,
          pageNumber: 1,
          startOffset: 0,
          endOffset: 530,
          tokenCount: 90,
          text: "Die Systemarchitektur von RelationNotes basiert auf einem konsolidierten Cloudflare Single Worker. Dieser vereint REST-API-Routing mit Hono, statisches Asset-Serving, Authentifizierung und WebSockets unter einer einheitlichen Edge-Codebase. Durch die Bündelung entfallen Microservice-Latenzen und Cold-Starts zwischen internen Modulen werden eliminiert."
        },
        {
          id: "chk_cf_01_02",
          chunkIndex: 1,
          pageNumber: 2,
          startOffset: 531,
          endOffset: 1110,
          tokenCount: 97,
          text: "Zustandsbehaftete Echtzeitkollaboration und Vektor-Caches werden über SQLite-basierte Durable Objects realisiert. Der NotebookDO hält quantisierte int8-Embeddings im warmen Arbeitsspeicher und führt Vektorsuchen in weniger als 5 Millisekunden aus. Über die WebSocket Hibernation API schlafen Instanzen bei Inaktivität ein und halten Verbindungen ohne CPU-Kosten offen."
        },
        {
          id: "chk_cf_01_03",
          chunkIndex: 2,
          pageNumber: 3,
          startOffset: 1111,
          endOffset: 1690,
          tokenCount: 93,
          text: "Asynchrone Hintergrundaufgaben, wie Dokumenten-Parsing, Audio-Synthese oder Datenexporte, delegiert der Worker an den JobDO. Dieser verwaltet Fortschrittszustände, Statusabfragen und Webhooks mit automatischer Retry-Logik und vollständiger Isolation vom interaktiven Chat-Pfad."
        }
      ]
    },
    {
      id: "src_cf_02_d1_vectors",
      title: "D1 int8 Vektoren & FTS5 Hybrid Search mit RRF",
      originalName: "D1_Vector_Hybrid_Search.md",
      mimeType: "text/markdown",
      sourceType: "md",
      byteSize: 142_800,
      chunks: [
        {
          id: "chk_cf_02_01",
          chunkIndex: 0,
          pageNumber: 1,
          startOffset: 0,
          endOffset: 520,
          tokenCount: 88,
          text: "Zur effizienten Speicherung hochdimensionaler Vektoren auf ressourcenbeschränkten Edge-Knoten nutzt RelationNotes skalare int8-Quantisierung. 768-dimensionale Float32-Vektoren werden auf vorzeichenbehaftete 8-Bit-Integers abgebildet, wodurch die Datensatzgröße pro Vektor von 3072 Bytes auf 768 Bytes schrumpft (75% Reduktion)."
        },
        {
          id: "chk_cf_02_02",
          chunkIndex: 1,
          pageNumber: 2,
          startOffset: 521,
          endOffset: 1100,
          tokenCount: 96,
          text: "In SQLite D1 wird parallel eine Volltextsuche mittels FTS5 Virtual Tables mit BM25-Relevanz und Triggern gepflegt. Trifft eine Suchanfrage ein, berechnet das System parallel Vektor-Scores über Cosinus-Ähnlichkeit und BM25-Scores über FTS5 MATCH. Die Fusion erfolgt mit Reciprocal Rank Fusion (RRF, k=60), was sowohl exakte Code- und Paragraphen-Matches als auch konzeptuelle Synonyme priorisiert."
        }
      ]
    },
    {
      id: "src_cf_03_dual_runtime",
      title: "Dual-Runtime-Konzept: Cloudflare Worker & Native Node.js/Docker",
      originalName: "Dual_Runtime_Architecture.md",
      mimeType: "text/markdown",
      sourceType: "md",
      byteSize: 118_600,
      chunks: [
        {
          id: "chk_cf_03_01",
          chunkIndex: 0,
          pageNumber: 1,
          startOffset: 0,
          endOffset: 540,
          tokenCount: 91,
          text: "Um Vendor-Lock-in zu verhindern und vollständig lokale On-Premise-Deployments zu ermöglichen, implementiert das System eine strikte Dual-Runtime-Architektur. Das Backend läuft identisch auf Cloudflare Workers (V8 Isolate) und nativ unter Node.js (via @hono/node-server und node:sqlite DatabaseSync)."
        },
        {
          id: "chk_cf_03_02",
          chunkIndex: 1,
          pageNumber: 2,
          startOffset: 541,
          endOffset: 1120,
          tokenCount: 95,
          text: "Ein universeller DatabaseAdapter kapselt die Unterschiede zwischen D1Database und node:sqlite ab. Ein Dateisystem-R2-Adapter emuliert Cloudflare R2 lokal im Verzeichnis .data/media. So können Entwickler und datenschutzsensible Kunden die gesamte Plattform isoliert im Docker-Container oder auf einem lokalen Server betreiben."
        }
      ]
    },
    {
      id: "src_cf_04_a11y_craft",
      title: "High-Craft Web Engineering & Barrierefreiheit (WCAG 2.2 AAA)",
      originalName: "High_Craft_Web_Engineering_A11y.md",
      mimeType: "text/markdown",
      sourceType: "md",
      byteSize: 135_100,
      chunks: [
        {
          id: "chk_cf_04_01",
          chunkIndex: 0,
          pageNumber: 1,
          startOffset: 0,
          endOffset: 530,
          tokenCount: 89,
          text: "Barrierefreiheit ist bei RelationNotes kein nachgelagerter Audit-Punkt, sondern ein Kernkriterium des Software-Designs. Das Frontend erfüllt WCAG 2.2 Level AA und strebt AAA-Konformität an. Alle interaktiven Komponenten besitzen Touch-Ziele von mindestens 44x44 CSS-Pixeln, Kontrastverhältnisse von 7:1 für Standardtexte und vollständige Tastaturnavigation ohne Focus-Traps."
        },
        {
          id: "chk_cf_04_02",
          chunkIndex: 1,
          pageNumber: 2,
          startOffset: 531,
          endOffset: 1130,
          tokenCount: 98,
          text: "Für dynamische Chat-Streaming-Ausgaben und Zitate implementiert RelationNotes einen gedrosselten aria-live-Announcer. Screenreader werden nicht mit einzelnen Token-Updates überflutet, sondern erhalten semantisch zusammengefasste Abschnitte. Zitate werden als barrierefreie Buttons mit Quellen-Tooltip und Sprungmarken in den Source-Viewer gerendert."
        }
      ]
    }
  ],
  chats: [
    {
      id: "chat_cf_01",
      title: "Architekturvorteile & Edge-Leistung",
      modelUsed: "gemini-2.5-flash",
      messages: [
        {
          id: "msg_cf_01_user",
          role: "user",
          content:
            "Wie erreicht RelationNotes Sub-Millisekunden-Reaktionszeiten bei der Vektorsuche trotz ressourcenschonender Edge-Architektur?"
        },
        {
          id: "msg_cf_01_asst",
          role: "assistant",
          content:
            "Die hohe Leistungsfähigkeit bei minimalem Ressourcenverbrauch basiert auf dem Zusammenspiel dreier Architekturbausteine:\n\n1. **int8-Skalarquantisierung**: 768-dimensionale Vektoren werden von 32-Bit-Floats auf 8-Bit-Integers komprimiert, was den Speicherbedarf um 75% reduziert [1].\n2. **SQLite Durable Objects im RAM**: Der NotebookDO hält die quantisierten Vektoren im Arbeitsspeicher und berechnet Dot-Products über optimierte Schleifen in unter 5 Millisekunden [2].\n3. **Hybrid RRF Fusion**: Die semantische Vektorsuche wird parallel mit SQLite D1 FTS5 Volltextsuche ausgeführt und via Reciprocal Rank Fusion verschmolzen, sodass sowohl exakte Fachbegriffe als auch semantische Bedeutungen präzise getroffen werden [3].",
          aiGenerated: true,
          latencyMs: 380,
          citations: [
            {
              chunkId: "chk_cf_02_01",
              sourceId: "src_cf_02_d1_vectors",
              pageNumber: 1,
              quote:
                "768-dimensionale Float32-Vektoren werden auf vorzeichenbehaftete 8-Bit-Integers abgebildet, wodurch die Datensatzgröße pro Vektor von 3072 Bytes auf 768 Bytes schrumpft (75% Reduktion)."
            },
            {
              chunkId: "chk_cf_01_02",
              sourceId: "src_cf_01_worker_do",
              pageNumber: 2,
              quote:
                "Der NotebookDO hält quantisierte int8-Embeddings im warmen Arbeitsspeicher und führt Vektorsuchen in weniger als 5 Millisekunden aus."
            },
            {
              chunkId: "chk_cf_02_02",
              sourceId: "src_cf_02_d1_vectors",
              pageNumber: 2,
              quote:
                "In SQLite D1 wird parallel eine Volltextsuche mittels FTS5 Virtual Tables mit BM25-Relevanz und Triggern gepflegt. ... Die Fusion erfolgt mit Reciprocal Rank Fusion (RRF, k=60)"
            }
          ]
        }
      ]
    }
  ],
  artifacts: [
    {
      id: "art_cf_01_audio",
      type: "audio",
      title: "Audio Overview: Edge-Architektur im Deep-Dive",
      status: "ready",
      r2Key: "artifacts/nb_demo_cloudflare_architecture/audio_overview.mp3",
      contentJson: JSON.stringify({
        format: "technical_deep_dive",
        speakers: ["Lead Cloud Architect", "Senior Edge Engineer"],
        durationSeconds: 165,
        vttCueCount: 22,
        transcriptUrl: "artifacts/nb_demo_cloudflare_architecture/audio_overview.vtt",
        summary:
          "Detaillierter Podcast über Cloudflare Single Worker, Durable Objects Hibernation und int8 Vektorquantisierung."
      })
    },
    {
      id: "art_cf_02_video",
      type: "video",
      title: "Video Storyboard: Single Worker & Dual-Runtime",
      status: "ready",
      contentJson: JSON.stringify({
        title: "Von der Edge zum On-Premise Docker: Dual-Runtime im Detail",
        scenes: [
          {
            scene: 1,
            title: "Cloudflare Single Worker Edge",
            visual: "Edge-Netzwerk mit V8 Isolates und Hibernating Durable Objects",
            voiceover: "Global verteilt, Sub-Millisekunden-Latenz und keine Cold-Starts.",
            durationSec: 20
          },
          {
            scene: 2,
            title: "Dual-Runtime Abstraction Layer",
            visual: "DatabaseAdapter verbindet D1 und node:sqlite ohne Codeänderung",
            voiceover:
              "Ein Codebase, zwei Welten: Serverless Edge oder autarkes Docker-Deployment.",
            durationSec: 25
          }
        ]
      })
    },
    {
      id: "art_cf_03_mindmap",
      type: "mindmap",
      title: "Mindmap: Edge Systemarchitektur",
      status: "ready",
      contentJson: JSON.stringify({
        root: {
          id: "cf_root",
          label: "Cloudflare Edge Stack",
          children: [
            {
              id: "cf_compute",
              label: "Compute",
              children: [
                { id: "cf_c1", label: "Single Worker (Hono)" },
                { id: "cf_c2", label: "NotebookDO (In-Memory Vectors)" },
                { id: "cf_c3", label: "JobDO (Background Queue)" }
              ]
            },
            {
              id: "cf_storage",
              label: "Storage & RAG",
              children: [
                { id: "cf_s1", label: "D1 SQLite Relational" },
                { id: "cf_s2", label: "D1 FTS5 BM25 Fulltext" },
                { id: "cf_s3", label: "int8 Quantized Vectors" },
                { id: "cf_s4", label: "R2 Object Storage" }
              ]
            },
            {
              id: "cf_craft",
              label: "Craft & A11y",
              children: [
                { id: "cf_a1", label: "WCAG 2.2 AAA Standards" },
                { id: "cf_a2", label: "Throttled aria-live" },
                { id: "cf_a3", label: "44x44px Touch Targets" }
              ]
            }
          ]
        }
      })
    },
    {
      id: "art_cf_04_flashcards",
      type: "flashcards",
      title: "Lernkartei: Edge & Vektor-Engineering",
      status: "ready",
      contentJson: JSON.stringify({
        cards: [
          {
            front: "Was bewirkt die WebSocket Hibernation API in Durable Objects?",
            back: "Ermöglicht es Durable Objects, bei inaktiven WebSockets aus dem Speicher entladen zu werden, ohne Verbindungen zu trennen. Reduziert Kosten drastisch.",
            sourceHint: "Cloudflare Single Worker & Hibernating Durable Objects"
          },
          {
            front: "Wie viel Speicher spart int8-Skalarquantisierung gegenüber float32?",
            back: "Genau 75% (1 Byte statt 4 Bytes pro Dimension, 768 Bytes statt 3072 Bytes bei 768 Dimensionen).",
            sourceHint: "D1 int8 Vektoren & FTS5 Hybrid Search mit RRF"
          },
          {
            front:
              "Wie garantiert RelationNotes barrierefreie Screenreader-Ausgaben bei LLM-Streaming?",
            back: "Durch einen gedrosselten aria-live Announcer, der zusammenhängende Textabschnitte meldet statt jedes einzelne Token.",
            sourceHint: "High-Craft Web Engineering & Barrierefreiheit (WCAG 2.2 AAA)"
          }
        ]
      })
    },
    {
      id: "art_cf_05_quiz",
      type: "quiz",
      title: "Wissenstest: Cloudflare Edge & High-Craft Web",
      status: "ready",
      contentJson: JSON.stringify({
        questions: [
          {
            id: "qc1",
            question: "Welcher SQLite-Mechanismus wird in D1 für die Volltextsuche verwendet?",
            options: ["fts3", "FTS5 mit BM25", "RegEx Match", "LIKE '%query%'"],
            correctAnswerIndex: 1,
            explanation:
              "D1 nutzt die FTS5 Virtual Table mit BM25-Ranking und automatischen Triggern."
          },
          {
            id: "qc2",
            question:
              "Welche Mindestgröße müssen barrierefreie Touch-Ziele nach WCAG 2.5.5 (AAA) aufweisen?",
            options: ["24x24px", "32x32px", "44x44px", "48x48px"],
            correctAnswerIndex: 2,
            explanation: "WCAG 2.5.5 Target Size (Enhanced) fordert mindestens 44x44 CSS-Pixel."
          }
        ]
      })
    },
    {
      id: "art_cf_06_briefing",
      type: "briefing",
      title: "Executive Briefing: Edge-First Architekturstrategie",
      status: "ready",
      contentJson: JSON.stringify({
        executiveSummary:
          "Die Cloudflare Edge & Dual-Runtime-Architektur von RelationNotes demonstriert Spitzenleistung im Web-Engineering: Enterprise-Qualität, null Lock-in, vorbildliche Barrierefreiheit und minimale Betriebskosten.",
        keyTakeaways: [
          "Single-Worker-Konsolidierung spart Kosten und optimiert Latenzen.",
          "Dual-Runtime stellt sicher, dass Kunden das System sowohl auf Cloudflare als auch autark on-premise betreiben können.",
          "WCAG 2.2 AAA Konformität macht die Software für alle Menschen zugänglich und setzt Branchenmaßstäbe."
        ],
        actionItems: [
          "D1- und R2-Ressourcen in Cloudflare Dashboard anbinden",
          "Automatisierte CI/CD-Pipelines mit 100% Testabdeckung verifizieren",
          "OpenSSF Best Practices Scorecard und Provenance-Badges prüfen"
        ]
      })
    }
  ],
  notes: [
    {
      id: "note_cf_01",
      title: "Architektur-Notiz: Benchmarks & Latenzen",
      content:
        "Messwerte der Testsuite:\n- int8 Vektorsuche im DO RAM: < 5ms bei 1000 Chunks\n- FTS5 Query Latenz D1: < 12ms\n- RRF Kombinationsdauer: < 1ms\n- Node.js Startup-Zeit: < 150ms",
      version: 1
    }
  ]
};
