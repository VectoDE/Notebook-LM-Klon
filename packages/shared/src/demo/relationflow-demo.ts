/**
 * Demo Dataset: RelationFlow & KI im Mittelstand (DSGVO, EU AI Act & RAG)
 * Tailored for Everlast Consulting GmbH / RelationFlow.
 *
 * Implements Sub-Issue #107 (Issue #21, Decisions #45, #63, #69).
 * Contains:
 * - 4 comprehensive, realistic German source documents
 * - Pre-chunked text with character offsets & page numbers
 * - Pre-calculated citations and chat history
 * - All 6 studio artifacts (Audio Overview, Video Storyboard, Mindmap, Flashcards, Quiz, Briefing)
 * - Collaborative notes
 */

import type { DemoNotebookDefinition } from "./demo-types.d.js";

export const RELATIONFLOW_NOTEBOOK_ID = "nb_demo_relationflow";

export const RELATIONFLOW_DEMO_NOTEBOOK: DemoNotebookDefinition = {
  id: RELATIONFLOW_NOTEBOOK_ID,
  title: "RelationFlow & KI im Mittelstand (DSGVO, EU AI Act & RAG)",
  emoji: "shield",
  description:
    "Muster-Arbeitsbereich für mittelständische Unternehmen: Rechtssichere KI-Einführung mit Everlast Consulting GmbH, Datenschutz nach DSGVO, Risikoklassen des EU AI Act und RAG-Architektur.",
  sources: [
    {
      id: "src_rf_01_dsgvo",
      title: "DSGVO-Leitfaden: Personenbezogene Daten in LLM-Systemen",
      originalName: "DSGVO_LLM_Leitfaden_Everlast.pdf",
      mimeType: "application/pdf",
      sourceType: "pdf",
      byteSize: 145_200,
      chunks: [
        {
          id: "chk_rf_01_01",
          chunkIndex: 0,
          pageNumber: 1,
          startOffset: 0,
          endOffset: 520,
          tokenCount: 88,
          text: "Die Verarbeitung personenbezogener Daten im Rahmen generativer KI-Anwendungen unterliegt den strengen Vorgaben der Datenschutz-Grundverordnung (DSGVO). Gemäß Art. 5 Abs. 1 lit. c DSGVO gilt der Grundsatz der Datenminimierung. Für mittelständische Betriebe bedeutet dies, dass Prompt-Eingaben vor der Übertragung an externe Sprachmodelle pseudonymisiert oder bereinigt werden müssen, sofern keine Auftragsverarbeitungsvereinbarung (AVV nach Art. 28 DSGVO) mit EU-Hosting vorliegt."
        },
        {
          id: "chk_rf_01_02",
          chunkIndex: 1,
          pageNumber: 2,
          startOffset: 521,
          endOffset: 1090,
          tokenCount: 96,
          text: "Ein zentrales Risiko beim Einsatz von Cloud-LLMs stellt das unberechtigte Re-Training auf Kundendaten dar. Everlast Consulting empfiehlt für RelationFlow eine Zero-Data-Retention-Garantie (ZDR) der API-Provider oder den Betrieb lokaler Open-Source-Modelle via Ollama. Durch Bring-Your-Own-Key (BYOK) mit clientseitiger AES-256-GCM Verschlüsselung verbleiben kryptografische Schlüssel und Datenhoheit vollständig beim Mandanten."
        },
        {
          id: "chk_rf_01_03",
          chunkIndex: 2,
          pageNumber: 3,
          startOffset: 1091,
          endOffset: 1680,
          tokenCount: 102,
          text: "Betroffenenrechte gemäß Art. 15 (Auskunft) und Art. 17 (Recht auf Löschen) lassen sich in reinen Black-Box-Neuronalnetzen nur schwer durchsetzen, wenn Daten in die Modellgewichte eingeflossen sind. Durch die Entkopplung von Wissensbasis und Modell im Retrieval-Augmented Generation (RAG)-Verfahren können Dokumente und Chunks in der Vektordatenbank sekundenschnell DSGVO-konform gelöscht werden, ohne das Modell neu trainieren zu müssen."
        }
      ]
    },
    {
      id: "src_rf_02_ai_act",
      title: "EU AI Act Compliance & Risikoklassifizierung für KMU",
      originalName: "EU_AI_Act_KMU_Klassifizierung.pdf",
      mimeType: "application/pdf",
      sourceType: "pdf",
      byteSize: 182_400,
      chunks: [
        {
          id: "chk_rf_02_01",
          chunkIndex: 0,
          pageNumber: 1,
          startOffset: 0,
          endOffset: 540,
          tokenCount: 92,
          text: "Die Verordnung (EU) 2024/1689 (EU AI Act) teilt KI-Systeme in vier Risikoklassen ein: Unannehmbares Risiko (verboten), Hohes Risiko, Spezifisches Transparenzrisiko und Minimales Risiko. Interne Wissens- und Dokumentenassistenzsysteme wie RelationNotes fallen in der Regel unter das spezifische Transparenzrisiko gemäß Art. 50 EU AI Act, sofern keine automatisierte Entscheidungsfindung in HR- oder Kreditvergabeprozessen stattfindet."
        },
        {
          id: "chk_rf_02_02",
          chunkIndex: 1,
          pageNumber: 2,
          startOffset: 541,
          endOffset: 1120,
          tokenCount: 98,
          text: "Gemäß Art. 50 Abs. 2 EU AI Act müssen Anbieter und Betreiber sicherstellen, dass KI-generierte Inhalte maschinenlesbar gekennzeichnet und für menschliche Nutzer transparent als solche erkennbar sind. Dies erfordert in Chat-Schnittstellen sichtbare Disclaimers, die Angabe des verwendeten KI-Modells sowie zitierbare Quellenbelege, um Halluzinationen und Intransparenz auszuschließen."
        },
        {
          id: "chk_rf_02_03",
          chunkIndex: 2,
          pageNumber: 3,
          startOffset: 1121,
          endOffset: 1690,
          tokenCount: 95,
          text: "Für General Purpose AI (GPAI)-Modelle greifen zusätzliche Transparenz- und Copyright-Nachweispflichten. Mittelständische Integratoren erfüllen ihre Sorgfaltspflicht am effektivsten durch standardisierte Governance-Dokumentationen, ein KI-Verzeichnis gemäß Art. 49 und die Auditierung eingesetzter Drittanbieter-Schnittstellen."
        }
      ]
    },
    {
      id: "src_rf_03_rag_arch",
      title: "Architekturkonzept: Hybrid-RAG auf Cloudflare & Edge-Workers",
      originalName: "RelationFlow_RAG_Architecture.md",
      mimeType: "text/markdown",
      sourceType: "md",
      byteSize: 98_300,
      chunks: [
        {
          id: "chk_rf_03_01",
          chunkIndex: 0,
          pageNumber: 1,
          startOffset: 0,
          endOffset: 510,
          tokenCount: 86,
          text: "RelationFlow implementiert eine skalierbare Dual-Pipeline-RAG-Architektur: Bei der Ingestion werden Quelltexte segmentiert und mittels 768-dimensionaler Vektoren quantisiert (int8 Scalar Quantization mit 75% Speicherersparnis). Die Suche kombiniert semantische Cosinus-Ähnlichkeit im Arbeitsspeicher von SQLite Durable Objects mit Volltextsuche via SQLite D1 FTS5 (BM25)."
        },
        {
          id: "chk_rf_03_02",
          chunkIndex: 1,
          pageNumber: 2,
          startOffset: 511,
          endOffset: 1080,
          tokenCount: 94,
          text: "Die Fusion der Vektor- und FTS5-Ergebnisse erfolgt über Reciprocal Rank Fusion (RRF, Standard-Konstante k=60). Dadurch werden exakte Keyword-Treffer (z.B. Paragraphen, Aktenzeichen, Produktnummern) mit breitem semantischem Kontext vereint. Dies verhindert typische Schwächen reiner Vektorsuchen bei Fachtermini."
        },
        {
          id: "chk_rf_03_03",
          chunkIndex: 2,
          pageNumber: 3,
          startOffset: 1081,
          endOffset: 1610,
          tokenCount: 89,
          text: "Der Datenschutz wird architektonisch an der Edge garantiert: Cloudflare Worker führen Ingestion und RRF aus, sensible Kundendokumente in R2 sind serverseitig verschlüsselt und für hochsensible Umgebungen schaltet der Auto-Router nahtlos auf die lokale Ollama-Instanz um."
        }
      ]
    },
    {
      id: "src_rf_04_consulting",
      title: "Everlast Consulting: Einführungskonzept & Change Management",
      originalName: "Everlast_Consulting_Vorgehensmodell.pdf",
      mimeType: "application/pdf",
      sourceType: "pdf",
      byteSize: 112_000,
      chunks: [
        {
          id: "chk_rf_04_01",
          chunkIndex: 0,
          pageNumber: 1,
          startOffset: 0,
          endOffset: 490,
          tokenCount: 82,
          text: "Das 3-Phasen-Einführungskonzept von Everlast Consulting GmbH für den deutschen Mittelstand gliedert sich in: 1. Readiness & Compliance Audit (DSGVO, Betriebsrat, AI Act), 2. Pilotierung mit RelationNotes in einer isolierten Fachabteilung, 3. Rollout mit rollenbasiertem Wissensmanagement und Schulungsprogramm."
        },
        {
          id: "chk_rf_04_02",
          chunkIndex: 1,
          pageNumber: 2,
          startOffset: 491,
          endOffset: 1040,
          tokenCount: 91,
          text: "Ein wesentlicher Erfolgsfaktor ist die Einbindung des Betriebsrats und Datenschutzbeauftragten ab Tag 1. Durch transparente Protokollierung im Audit-Log und strikte rollenbasierte Zugriffskontrollen (RBAC) in RelationFlow-Workspaces werden Ängste vor Leistungskontrollen abgebaut und Vertrauen geschaffen."
        }
      ]
    }
  ],
  chats: [
    {
      id: "chat_rf_01",
      title: "DSGVO- und AI-Act-Konformität im Betrieb",
      modelUsed: "gemini-2.5-flash",
      messages: [
        {
          id: "msg_rf_01_user",
          role: "user",
          content:
            "Welche regulatorischen Vorgaben müssen wir nach DSGVO und EU AI Act beachten, wenn wir RelationNotes für Kundendokumente einsetzen?"
        },
        {
          id: "msg_rf_01_asst",
          role: "assistant",
          content:
            "Beim Einsatz von RelationNotes für Kundendokumente sind zwei wesentliche Rechtsrahmen einzuhalten:\n\n1. **Datenschutz-Grundverordnung (DSGVO)**: Gemäß dem Grundsatz der Datenminimierung (Art. 5 Abs. 1 lit. c DSGVO) müssen Prompt-Eingaben geschützt und idealerweise pseudonymisiert werden [1]. Durch den RAG-Ansatz können Dokumente und Chunks bei Auskunfts- oder Löschanfragen (Art. 17 DSGVO) direkt aus der Datenbank entfernt werden, da sie nicht in die Modellgewichte einfließen [2]. Zudem sichert BYOK mit clientseitiger AES-256-GCM Verschlüsselung die Mandantentrennung [3].\n\n2. **EU AI Act**: Interne Wissensassistenzsysteme fallen typischerweise unter das spezifische Transparenzrisiko nach Art. 50 EU AI Act [4]. Dies verlangt eine maschinenlesbare Kennzeichnung von KI-Inhalten, klare Transparenzhinweise für Nutzer und zitierbare Quellenbelege zur Vermeidung von Halluzinationen [5].",
          aiGenerated: true,
          latencyMs: 420,
          citations: [
            {
              chunkId: "chk_rf_01_01",
              sourceId: "src_rf_01_dsgvo",
              pageNumber: 1,
              quote:
                "Gemäß Art. 5 Abs. 1 lit. c DSGVO gilt der Grundsatz der Datenminimierung. Für mittelständische Betriebe bedeutet dies, dass Prompt-Eingaben vor der Übertragung an externe Sprachmodelle pseudonymisiert oder bereinigt werden müssen"
            },
            {
              chunkId: "chk_rf_01_03",
              sourceId: "src_rf_01_dsgvo",
              pageNumber: 3,
              quote:
                "Durch die Entkopplung von Wissensbasis und Modell im Retrieval-Augmented Generation (RAG)-Verfahren können Dokumente und Chunks in der Vektordatenbank sekundenschnell DSGVO-konform gelöscht werden"
            },
            {
              chunkId: "chk_rf_01_02",
              sourceId: "src_rf_01_dsgvo",
              pageNumber: 2,
              quote:
                "Durch Bring-Your-Own-Key (BYOK) mit clientseitiger AES-256-GCM Verschlüsselung verbleiben kryptografische Schlüssel und Datenhoheit vollständig beim Mandanten."
            },
            {
              chunkId: "chk_rf_02_01",
              sourceId: "src_rf_02_ai_act",
              pageNumber: 1,
              quote:
                "Interne Wissens- und Dokumentenassistenzsysteme wie RelationNotes fallen in der Regel unter das spezifische Transparenzrisiko gemäß Art. 50 EU AI Act"
            },
            {
              chunkId: "chk_rf_02_02",
              sourceId: "src_rf_02_ai_act",
              pageNumber: 2,
              quote:
                "Gemäß Art. 50 Abs. 2 EU AI Act müssen Anbieter und Betreiber sicherstellen, dass KI-generierte Inhalte maschinenlesbar gekennzeichnet und für menschliche Nutzer transparent als solche erkennbar sind."
            }
          ]
        }
      ]
    }
  ],
  artifacts: [
    {
      id: "art_rf_01_audio",
      type: "audio",
      title: "Audio Overview: KI-Compliance im Mittelstand",
      status: "ready",
      r2Key: "artifacts/nb_demo_relationflow/audio_overview.mp3",
      contentJson: JSON.stringify({
        format: "dialogue",
        speakers: ["Dr. Maria Weber (Everlast)", "Thomas Koch (IT-Leiter)"],
        durationSeconds: 142,
        vttCueCount: 18,
        transcriptUrl: "artifacts/nb_demo_relationflow/audio_overview.vtt",
        summary:
          "Zwei-Sprecher-Diskussion über DSGVO-konforme RAG-Architektur, Löschfristen und Transparenz nach EU AI Act."
      })
    },
    {
      id: "art_rf_02_video",
      type: "video",
      title: "Video Storyboard: 3-Phasen-Einführung mit Everlast",
      status: "ready",
      contentJson: JSON.stringify({
        title: "In 3 Schritten zur rechtssicheren Unternehmens-KI",
        scenes: [
          {
            scene: 1,
            title: "Ausgangslage im Mittelstand",
            visual: "KMU-Geschäftsführer vor Dokumentenstapel und Schatten-KI-Nutzung",
            voiceover:
              "Mitarbeiter nutzen private KI-Tools, Geschäftsgeheimnisse fließen ungeschützt ab.",
            durationSec: 15
          },
          {
            scene: 2,
            title: "Phase 1: Compliance-Audit & BYOK",
            visual: "Everlast Consulting analysiert Datenflüsse und richtet AES-256-GCM Vault ein",
            voiceover:
              "Klare Leitplanken: DSGVO-Auftragsverarbeitung und eigener Schlüsselbund verhindern Datentraining.",
            durationSec: 20
          },
          {
            scene: 3,
            title: "Phase 2 & 3: RelationFlow RAG & Produktivbetrieb",
            visual: "Dashboard mit Hybrid-Suche, Zitatbelegen und kollaborativen Notizen",
            voiceover:
              "Sekundenschnelle Antworten mit verifizierten Quellenstellen und voller Betriebsrat-Konformität.",
            durationSec: 25
          }
        ]
      })
    },
    {
      id: "art_rf_03_mindmap",
      type: "mindmap",
      title: "Mindmap: Governance & Compliance Architektur",
      status: "ready",
      contentJson: JSON.stringify({
        root: {
          id: "m_root",
          label: "KI im Mittelstand",
          children: [
            {
              id: "m_dsgvo",
              label: "DSGVO Schutz",
              children: [
                { id: "m_dsgvo_1", label: "Art. 5 Datenminimierung" },
                { id: "m_dsgvo_2", label: "Art. 17 Schnelle RAG-Löschung" },
                { id: "m_dsgvo_3", label: "BYOK & AES-256 Verschlüsselung" }
              ]
            },
            {
              id: "m_ai_act",
              label: "EU AI Act",
              children: [
                { id: "m_act_1", label: "Art. 50 Transparenzrisiko" },
                { id: "m_act_2", label: "Zitierbare Quellenbelege" },
                { id: "m_act_3", label: "Maschinenlesbare Kennzeichnung" }
              ]
            },
            {
              id: "m_tech",
              label: "RAG Technologie",
              children: [
                { id: "m_tech_1", label: "int8 Vektoren (75% Ersparnis)" },
                { id: "m_tech_2", label: "D1 FTS5 Keyword Match" },
                { id: "m_tech_3", label: "Reciprocal Rank Fusion" }
              ]
            }
          ]
        }
      })
    },
    {
      id: "art_rf_04_flashcards",
      type: "flashcards",
      title: "Lernkartei: Compliance & RAG Grundbegriffe",
      status: "ready",
      contentJson: JSON.stringify({
        cards: [
          {
            front: "Was regelt Art. 50 des EU AI Act für Chatbots?",
            back: "Transparenzpflicht: Nutzer müssen wissen, dass sie mit einer KI interagieren; generierte Inhalte müssen gekennzeichnet sein.",
            sourceHint: "EU AI Act Compliance & Risikoklassifizierung für KMU"
          },
          {
            front: "Warum ist RAG DSGVO-freundlicher als Feintuning?",
            back: "Bei RAG bleiben Fakten in der externen Datenbank. Bei Löschanträgen (Art. 17) wird der Datenbankeintrag gelöscht, statt das Modell neu trainieren zu müssen.",
            sourceHint: "DSGVO-Leitfaden: Personenbezogene Daten in LLM-Systemen"
          },
          {
            front: "Was bewirkt Reciprocal Rank Fusion (RRF)?",
            back: "Kombiniert Ranglisten aus Vektorsuche (semantisch) und FTS5 (lexikalisch) mit Standard-Konstante k=60 für präziseste Treffer.",
            sourceHint: "Architekturkonzept: Hybrid-RAG auf Cloudflare & Edge-Workers"
          }
        ]
      })
    },
    {
      id: "art_rf_05_quiz",
      type: "quiz",
      title: "Wissenstest: KI-Recht & RAG-Architektur",
      status: "ready",
      contentJson: JSON.stringify({
        questions: [
          {
            id: "q1",
            question:
              "Welcher Risikoklasse des EU AI Act unterliegen Dokumenten-RAG-Systeme üblicherweise?",
            options: [
              "Unannehmbares Risiko (verboten)",
              "Hohes Risiko",
              "Spezifisches Transparenzrisiko (Art. 50)",
              "Kein Risiko"
            ],
            correctAnswerIndex: 2,
            explanation:
              "Solange keine automatisierte HR- oder Kreditentscheidung vorliegt, greift die Transparenzpflicht nach Art. 50."
          },
          {
            id: "q2",
            question: "Welchen Vorteil bietet die int8-Quantisierung bei Vektoren?",
            options: [
              "Sie verdoppelt den Speicherbedarf",
              "Sie reduziert den Speicherbedarf um 75% bei minimalem Genauigkeitsverlust",
              "Sie verhindert Halluzinationen zu 100%",
              "Sie erfordert GPUs"
            ],
            correctAnswerIndex: 1,
            explanation:
              "Durch Skalierung von 32-Bit-Floats auf 8-Bit-Integers sinkt der Speicherverbrauch um das Vierfache."
          }
        ]
      })
    },
    {
      id: "art_rf_06_briefing",
      type: "briefing",
      title: "Executive Briefing: KI-Readiness für die Geschäftsführung",
      status: "ready",
      contentJson: JSON.stringify({
        executiveSummary:
          "Der Einsatz von RelationNotes in Kombination mit der Beratung von Everlast Consulting ermöglicht mittelständischen Betrieben den sicheren Übergang in die KI-Ära ohne Rechtsrisiken.",
        keyTakeaways: [
          "Zero-Data-Retention und BYOK schützen geistiges Eigentum und Kundengeheimnisse.",
          "Hybrid-RAG (Vektor + FTS5) eliminiert Halluzinationen durch nachweisbare Quellenzitate.",
          "Strukturierter 3-Phasen-Plan sichert Akzeptanz bei Belegschaft, Betriebsrat und Datenschutzbeauftragten."
        ],
        actionItems: [
          "Bestandsaufnahme bestehender Schatten-KI-Tools im Unternehmen",
          "Einrichtung des RelationFlow-Mandanten mit BYOK-Verschlüsselung",
          "Durchführung des Pilot-Workshops mit Everlast Consulting GmbH"
        ]
      })
    }
  ],
  notes: [
    {
      id: "note_rf_01",
      title: "Notiz: Nächste Schritte Pilotprojekt",
      content:
        "1. Auftragsverarbeitungsvertrag (AVV) mit Everlast Consulting finalisieren.\n2. BYOK-Schlüssel hinterlegen und Key-Rotation testen.\n3. Erste 10 Testdokumente aus der Rechtsabteilung hochladen und RAG-Hybrid-Suche abnehmen.",
      version: 1
    }
  ]
};
