/**
 * Bedientexte der Bereiche (Quellen, Chat, Studio) und der Werkzeugansichten (Issue #320).
 *
 * Jeder Eintrag steht als Tripel [Schlüssel, Deutsch, Englisch] nebeneinander, so bleiben
 * beide Sprachen deckungsgleich. Platzhalter stehen in geschweiften Klammern, z. B. {n}.
 * Inhalte aus Quellen und Demodaten (Titel, Quizfragen, Kartentexte, Transkripte,
 * Antworten der KI) gehören nicht hierher.
 */

type Entry = readonly [key: string, de: string, en: string];

const ENTRIES: readonly Entry[] = [
  // Quellen
  ["srcPanelLabel", "Quellen-Panel", "Sources panel"],
  [
    "srcSub",
    "Ausgewählte Quellen fließen in jede Antwort ein.",
    "Selected sources feed into every answer."
  ],
  ["srcCountOne", "{n} Quelle", "{n} source"],
  ["srcCountMany", "{n} Quellen", "{n} sources"],
  ["srcUpload", "Datei hochladen", "Upload file"],
  ["srcLink", "Link", "Link"],
  ["srcLinkAria", "Link oder Google Docs importieren", "Link or Google Docs import"],
  ["srcFileInputAria", "Dateien hochladen", "Upload files"],
  ["srcDropzoneLabel", "Datei-Dropzone", "File drop zone"],
  ["srcDropTitle", "Dateien hier ablegen", "Drop files here"],
  ["srcDropHint", "PDF, TXT oder Markdown", "PDF, TXT or Markdown"],
  ["srcSearchLabel", "Quellen durchsuchen", "Search sources"],
  ["srcSearchPlaceholder", "Quellen filtern …", "Filter sources …"],
  ["srcSelectAll", "Alle Quellen auswählen", "Select all sources"],
  ["srcListLabel", "Hochgeladene Quellen", "Uploaded sources"],
  ["srcSelectAria", "Quelle {title} für Chat auswählen", "Select source {title} for chat"],
  ["srcViewAria", "Quelle {title} ansehen", "View source {title}"],
  ["srcCloseAria", "Quelle {title} schließen", "Close source {title}"],
  ["srcView", "Ansehen", "View"],
  ["srcClose", "Schließen", "Close"],
  ["srcInspectorLabel", "Quell-Inspektor: {title}", "Source inspector: {title}"],
  ["srcInspectorClose", "Inspektor schließen", "Close inspector"],
  ["srcCitationFocus", "Fokussiertes Zitat", "Focused citation"],
  ["srcCitationPage", "(Seite {page})", "(page {page})"],
  [
    "srcNoFulltext",
    "Kein Volltext hinterlegt. Dokumentinhalt wird im Viewer angezeigt.",
    "No full text stored. The document content is shown in the viewer."
  ],
  ["srcDialogTitle", "Web-Link oder Google Docs importieren", "Import web link or Google Docs"],
  [
    "srcDialogText",
    "Geben Sie eine öffentlich zugängliche URL oder einen freigegebenen Google-Docs-Link ein.",
    "Enter a publicly accessible URL or a shared Google Docs link."
  ],
  ["srcTitleLabel", "Titel (optional)", "Title (optional)"],
  ["srcTitlePlaceholder", "z. B. API-Dokumentation", "e.g. API documentation"],
  ["srcUrlLabel", "URL", "URL"],
  ["srcUrlRequired", "Bitte geben Sie eine URL ein.", "Please enter a URL."],
  [
    "srcUrlInvalid",
    "Diese Adresse ist keine gültige URL. Sie muss mit https:// oder http:// beginnen, z. B. https://example.org/artikel.",
    "This address is not a valid URL. It must start with https:// or http://, e.g. https://example.org/article."
  ],
  ["srcCancel", "Abbrechen", "Cancel"],
  ["srcImport", "Importieren", "Import"],

  // Chat
  ["chatPanelLabel", "Wissens- und Chat-Panel", "Knowledge and chat panel"],
  ["chatStatusGenerating", "Antwort wird generiert.", "Generating answer."],
  ["chatStatusError", "Fehler: {error}", "Error: {error}"],
  ["chatStatusAborted", "Generierung abgebrochen.", "Generation stopped."],
  ["chatStatusDone", "Antwort vollständig.", "Answer complete."],
  ["chatLogLabel", "Chat-Verlauf", "Chat history"],
  ["chatUser", "Sie", "You"],
  ["chatAssistant", "RelationNotes Assistent", "RelationNotes Assistant"],
  ["chatReadAloud", "Vorlesen", "Read aloud"],
  ["chatReadAloudAria", "Vorlesen: Antwort", "Read aloud: answer"],
  ["chatCreating", "Antwort wird erstellt …", "Creating answer …"],
  ["chatRetry", "Erneut versuchen", "Try again"],
  ["chatAiLabel", "KI-generiert · {model}", "AI-generated · {model}"],
  ["chatChipsLabel", "Vorschlags-Fragen", "Suggested questions"],
  ["chatChip1", "Fasse die wichtigsten Erkenntnisse zusammen", "Summarize the key findings"],
  ["chatChip2", "Welche Kernarchitektur wird verwendet?", "Which core architecture is used?"],
  ["chatChip3", "Welche Sicherheitsgarantien bestehen?", "What security guarantees exist?"],
  ["chatInputPlaceholder", "Frage zu den Quellen stellen …", "Ask a question about your sources …"],
  [
    "chatInputAria",
    "Frage zu den Quellen eingeben",
    "Ask a question about your sources (type here)"
  ],
  ["chatStopAria", "Generierung stoppen", "Stop generation"],
  ["chatSendAria", "Frage absenden", "Send question"],
  ["chatCitationAria", "Zitat {n} in Quelle anzeigen", "Show citation {n} in source"],
  ["chatCitationQuote", "Zitat [{n}]", "Citation [{n}]"],

  // Studio
  ["studioPanelLabel", "Studio-Panel", "Studio panel"],
  ["studioSub", "{n} Werkzeuge aus Ihren Quellen", "{n} tools from your sources"],
  ["studioBack", "Alle Werkzeuge", "All tools"],
  ["studioToolsLabel", "Studio-Werkzeuge", "Studio tools"],
  [
    "toolAudioDesc",
    "Zwei-Sprecher-Podcast mit interaktiver Host-Zwischenfrage.",
    "Two-host podcast with an interactive host interjection."
  ],
  ["toolStage", "Bühne", "Stage"],
  [
    "toolStageAria",
    "Bühne im Vollbild öffnen (Deep Dive)",
    "Stage: open in full screen (Deep Dive)"
  ],
  ["toolVideoOpen", "Video ansehen", "Watch video"],
  ["toolMindmapTitle", "Wissens-Mindmap", "Knowledge Mindmap"],
  [
    "toolMindmapDesc",
    "Interaktiver hierarchischer Wissensbaum mit SVG-Export.",
    "Interactive hierarchical knowledge tree with SVG export."
  ],
  ["toolMindmapOpen", "Erkunden", "Explore"],
  ["toolMindmapExport", "SVG", "SVG"],
  ["toolMindmapExportAria", "SVG exportieren (Mindmap)", "SVG: export (mindmap)"],
  ["toolCardsTitle", "Lernkarten", "Flashcards"],
  ["toolCardsOpen", "Lernen", "Study"],
  ["toolCardsExport", "Anki", "Anki"],
  ["toolCardsExportAria", "Anki-CSV exportieren (Lernkarten)", "Anki: export CSV (flashcards)"],
  ["toolQuizTitle", "Interaktives Quiz", "Interactive Quiz"],
  [
    "toolQuizDesc",
    "Multiple-Choice-Test mit quellenbelegten Erklärungen.",
    "Multiple-choice test with source-backed explanations."
  ],
  ["toolQuizOpen", "Starten", "Start"],
  ["toolQuizExport", "JSON", "JSON"],
  ["toolQuizExportAria", "JSON exportieren (Quiz)", "JSON: export (quiz)"],
  ["toolBriefingTitle", "Briefing & Timeline", "Briefing & Timeline"],
  [
    "toolBriefingDesc",
    "Management-Zusammenfassung, FAQ und Meilensteine.",
    "Executive summary, FAQ and milestones."
  ],
  ["toolBriefingExport", "Als Markdown exportieren", "Export as Markdown"],

  // Quiz
  ["quizDefaultTitle", "Wissens-Quiz", "Knowledge quiz"],
  [
    "quizEmpty",
    "Sobald Quellen ausgewählt sind, entstehen hier Fragen mit Erklärung und Quellenangabe.",
    "Once sources are selected, questions with explanations and citations appear here."
  ],
  ["quizAria", "Quiz: {title}", "Quiz: {title}"],
  ["quizProgress", "Frage {n} von {total}", "Question {n} of {total}"],
  ["quizAnswered", "Beantwortete Fragen", "Answered questions"],
  ["quizLiveRight", "Richtige Antwort ausgewählt.", "Correct answer selected."],
  [
    "quizLiveWrong",
    "Falsche Antwort ausgewählt. Richtig wäre gewesen: {answer}",
    "Wrong answer selected. The correct answer was: {answer}"
  ],
  [
    "quizLiveDone",
    "Quiz beendet. Ergebnis: {pct}% richtig.",
    "Quiz finished. Result: {pct}% correct."
  ],
  ["quizLiveReset", "Quiz zurückgesetzt.", "Quiz reset."],
  ["quizSummaryEyebrow", "Quiz-Auswertung", "Quiz results"],
  [
    "quizScore",
    "Ergebnis: {correct} von {total} richtig ({pct}%)",
    "Result: {correct} of {total} correct ({pct}%)"
  ],
  ["quizRepeat", "Quiz wiederholen", "Repeat quiz"],
  ["quizViewAnswers", "Antworten ansehen", "View answers"],
  ["quizOptionsAria", "Antwortoptionen für Frage {n}", "Answer options for question {n}"],
  ["quizRight", "Richtig", "Correct"],
  ["quizWrong", "Falsch", "Wrong"],
  ["quizExplanation", "Erklärung:", "Explanation:"],
  ["quizVerify", "Quelle belegen: {citation}", "Verify source: {citation}"],
  ["quizOriginalQuote", "Originalzitat ansehen", "View original quote"],
  ["quizBack", "Zurück", "Back"],
  ["quizNext", "Weiter", "Next"],
  ["quizFinish", "Quiz abschließen", "Finish quiz"],

  // Lernkarten
  ["cardsDefaultTitle", "Lernkartei", "Flashcard deck"],
  ["cardsToday", "heute", "today"],
  ["cardsTomorrow", "morgen", "tomorrow"],
  ["cardsInDays", "in {n} Tagen", "in {n} days"],
  ["cardsRepOne", "1 Wiederholung", "1 repetition"],
  ["cardsRepMany", "{n} Wiederholungen", "{n} repetitions"],
  [
    "cardsEmpty",
    "Sobald Quellen ausgewählt sind, entstehen hier Karten zum Wiederholen.",
    "Once sources are selected, cards for review appear here."
  ],
  ["cardsRatingAgain", "Nochmal", "Again"],
  ["cardsRatingHard", "Schwer", "Hard"],
  ["cardsRatingGood", "Gut", "Good"],
  ["cardsRatingEasy", "Einfach", "Easy"],
  ["cardsHintAgain", "Falsch erinnert", "Remembered wrongly"],
  ["cardsHintHard", "Mit Mühe erinnert", "Remembered with effort"],
  ["cardsHintGood", "Nach kurzem Zögern erinnert", "Remembered after a short pause"],
  ["cardsHintEasy", "Sofort fehlerfrei gewusst", "Knew it at once, no mistakes"],
  ["cardsAria", "Lernkarten: {title}", "Flashcards: {title}"],
  ["cardsCounter", "Karte {n} von {total}", "Card {n} of {total}"],
  ["cardsProgress", "Fortschritt im Stapel", "Progress in the deck"],
  ["cardsBackShown", "Rückseite angezeigt", "Back shown"],
  ["cardsFrontShown", "Vorderseite angezeigt", "Front shown"],
  [
    "cardsRated",
    "Karte bewertet als {rating}. Nächste Wiederholung: {when}.",
    "Card rated {rating}. Next review: {when}."
  ],
  ["cardsCardAria", "Lernkarte {n}: {side}", "Flashcard {n}: {side}"],
  ["cardsSideBack", "Rückseite", "Back"],
  ["cardsSideFront", "Vorderseite", "Front"],
  ["cardsEyebrowBack", "Antwort (Rückseite)", "Answer (back)"],
  ["cardsEyebrowFront", "Frage (Vorderseite)", "Question (front)"],
  ["cardsNextReview", "Nächste Wiederholung: {when} · {reps}", "Next review: {when} · {reps}"],
  ["cardsShowFront", "Vorderseite zeigen", "Show front"],
  ["cardsReveal", "Antwort aufdecken", "Reveal answer"],
  ["cardsSource", "Quelle: {hint}", "Source: {hint}"],
  ["cardsKeyHint", "Taste {key}: {hint}", "Key {key}: {hint}"],
  ["cardsNavLabel", "Kartenauswahl", "Card navigation"],
  ["cardsPrevAria", "Vorherige Karte (Pfeil links)", "Previous card (left arrow)"],
  ["cardsPrev", "Vorherige", "Previous"],
  ["cardsNextAria", "Nächste Karte (Pfeil rechts)", "Next card (right arrow)"],
  ["cardsNext", "Nächste", "Next"],

  // Mindmap
  ["mmDefaultTitle", "Wissens-Mindmap", "Knowledge Mindmap"],
  ["mmAria", "Mindmap: {title}", "Mindmap: {title}"],
  ["mmViewLabel", "Ansicht", "View"],
  ["mmTabVisual", "Grafik", "Graphic"],
  ["mmTabTree", "Baumliste", "Tree list"],
  ["mmZoom", "Zoom", "Zoom"],
  ["mmZoomOut", "Verkleinern", "Zoom out"],
  ["mmZoomIn", "Vergrößern", "Zoom in"],
  ["mmFit", "Einpassen", "Fit to view"],
  [
    "mmVisualHint",
    "Die Grafik ist nur zum Ansehen; Pfeiltasten verschieben die Ansicht. Alle Punkte der Mindmap stehen im Reiter Baumliste, dort per Tastatur und Screenreader bedienbar.",
    "The graphic is for viewing only; arrow keys move the view. All points of the mindmap are in the Tree list tab, where keyboard and screen reader users can operate them."
  ],
  [
    "mmTreeHint",
    "Pfeil hoch und runter wechseln den Eintrag. Pfeil rechts öffnet einen Zweig, Pfeil links schließt ihn oder springt zum übergeordneten Eintrag. Pos1 und Ende springen an den Anfang und das Ende. Eingabe oder Leertaste öffnet die Quelle.",
    "Up and down arrows change the entry. Right arrow opens a branch, left arrow closes it or jumps to the parent entry. Home and End jump to the start and the end. Enter or Space opens the source."
  ],
  ["mmTreeAria", "Baumliste der Mindmap {title}", "Tree list of the mindmap {title}"],

  // Video
  ["mediaPlay", "Abspielen", "Play"],
  ["mediaPause", "Pausieren", "Pause"],
  ["videoAria", "Video-Übersicht: {title}", "Video overview: {title}"],
  [
    "videoHint",
    "Tasten im Player: Leertaste oder K spielt und pausiert, Pfeil links und rechts springen 5 Sekunden, C schaltet Untertitel, D die Audiodeskription.",
    "Player keys: Space or K plays and pauses, left and right arrows skip 5 seconds, C toggles subtitles, D toggles the audio description."
  ],
  ["videoSource", "Quelle: „{title}“ – „{quote}“", "Source: “{title}” – “{quote}”"],
  ["videoSlide", "Folie", "Slide"],
  ["videoSlideAria", "Folie {n} von {total}: {title}", "Slide {n} of {total}: {title}"],
  ["videoLiveAd", "Audiodeskription: {text}", "Audio description: {text}"],
  ["videoLiveJump", "Sprung zu Kapitel: {title}", "Jumped to chapter: {title}"],
  ["videoSubsOn", "Untertitel an.", "Subtitles on."],
  ["videoSubsOff", "Untertitel aus.", "Subtitles off."],
  ["videoAdOn", "Audiodeskription an: {text}", "Audio description on: {text}"],
  ["videoAdOff", "Audiodeskription aus.", "Audio description off."],
  ["videoTime", "{current} von {total}", "{current} of {total}"],
  ["videoChapter", "Kapitel: {title}", "Chapter: {title}"],
  ["videoScrub", "Wiedergabeposition", "Playback position"],
  ["videoSubtitles", "Untertitel", "Subtitles"],
  ["videoAudioDesc", "Audiodeskription", "Audio description"],
  ["videoChaptersNav", "Kapitelauswahl", "Chapter selection"],
  ["videoChaptersLabel", "Kapitel:", "Chapters:"],
  ["videoChapterSr", ", Kapitel {n} von {total}", ", chapter {n} of {total}"],

  // Audio-Player
  ["audioDefaultTitle", "Audio Overview: Deep Dive Podcast", "Audio Overview: Deep Dive Podcast"],
  [
    "audioInterjectStatus",
    "Zwischenfrage-Modus aktiv. Tippen Sie Ihre Rückfrage ein oder drücken Sie Escape zum Abbrechen.",
    "Interjection mode is on. Type your question or press Escape to cancel."
  ],
  [
    "audioReady",
    "Audio bereit. Drücken Sie auf 'Beitreten / Frage stellen', um eine Zwischenfrage zu stellen.",
    "Audio ready. Press 'Join / ask a question' to interject with a question."
  ],
  ["audioPausedMsg", "Wiedergabe pausiert.", "Playback paused."],
  ["audioPlayingMsg", "Wiedergabe läuft.", "Playback running."],
  [
    "audioNoSpeech",
    "Spracherkennung wird von Ihrem Browser nicht unterstützt. Bitte Textfeld nutzen.",
    "Your browser does not support speech recognition. Please use the text field."
  ],
  [
    "audioMicListening",
    "Mikrofon lauscht... Sprechen Sie jetzt.",
    "The microphone is listening... Speak now."
  ],
  [
    "audioMicError",
    "Mikrofon-Fehler: {error}. Nutzen Sie das Textfeld.",
    "Microphone error: {error}. Use the text field."
  ],
  ["audioMicUnknown", "Unbekannter Fehler", "Unknown error"],
  [
    "audioMicInitFailed",
    "Mikrofon konnte nicht initialisiert werden. Bitte Textfeld verwenden.",
    "The microphone could not be started. Please use the text field."
  ],
  [
    "audioMicActive",
    "Mikrofon aktiv. Sprechen Sie Ihre Frage oder tippen Sie in das Textfeld.",
    "Microphone on. Speak your question or type in the text field."
  ],
  [
    "audioCancelled",
    "Zwischenfrage abgebrochen. Wiedergabe fortgesetzt.",
    "Interjection cancelled. Playback resumed."
  ],
  [
    "audioPreparing",
    "Hosts bereiten quellengestützte Antwort vor...",
    "The hosts are preparing a source-based answer..."
  ],
  [
    "audioAnswering",
    "Hosts antworten auf Ihre Zwischenfrage...",
    "The hosts are answering your question..."
  ],
  [
    "audioAnswerDone",
    "Host-Antwort abgeschlossen. Haupt-Podcast läuft weiter.",
    "Host answer finished. The main podcast continues."
  ],
  [
    "audioAria",
    "Interaktiver Audio-Player & Host-Studio",
    "Interactive audio player & host studio"
  ],
  ["audioStatus", "Status: {state}", "Status: {state}"],
  ["audioTimeSr", "Zeit: ", "Time: "],
  ["audioControls", "Audio-Steuerung", "Audio controls"],
  ["audioJoin", "Beitreten / Frage stellen", "Join / ask a question"],
  ["audioDialogTitle", "Frage an die Podcast-Hosts stellen", "Ask the podcast hosts a question"],
  [
    "audioPausedAt",
    "Das Haupt-Audio wurde an Minute {time} pausiert. Die Hosts antworten anhand Ihrer Notebook-Quellen.",
    "The main audio was paused at minute {time}. The hosts answer based on your notebook sources."
  ],
  ["audioQuestionLabel", "Ihre Zwischenfrage:", "Your question:"],
  [
    "audioQuestionPlaceholder",
    "z.B. Wie wird hier die DSGVO-Löschung genau garantiert?",
    "e.g. How exactly is GDPR deletion guaranteed here?"
  ],
  ["audioMicStop", "Mikrofon stoppen", "Stop microphone"],
  ["audioMicStart", "Sprechen (Mikrofon)", "Speak (microphone)"],
  [
    "audioMicUnsupported",
    "(Mikrofon nicht verfügbar - Tastatureingabe aktiv)",
    "(Microphone not available - keyboard input active)"
  ],
  ["audioRecognized", "Erkannter Text: ", "Recognized text: "],
  ["audioAnalyzing", "Wird analysiert...", "Analyzing..."],
  ["audioAsk", "Frage stellen", "Ask question"],
  ["audioCancel", "Abbrechen (Esc)", "Cancel (Esc)"],
  ["audioAnswerTitle", "Antwort der Hosts", "Answer from the hosts"],
  ["audioSpeaker", "Sprecher: {name}", "Speaker: {name}"],
  ["audioCitations", "Belegte Quellen", "Cited sources"],
  ["audioCitationsHead", "Quellenbelege:", "Source references:"],
  ["audioCitePage", " (S. {page})", " (p. {page})"],
  ["audioCiteQuote", " – „{quote}“", " – “{quote}”"],
  ["audioResume", "Podcast fortsetzen ({time})", "Resume podcast ({time})"],
  [
    "audioResumeAria",
    "Podcast fortsetzen ({time}) und Host-Antwort beenden",
    "Resume podcast ({time}) and end the host answer"
  ],
  ["podStateIdle", "Bereit", "Ready"],
  ["podStatePlaying", "Läuft", "Playing"],
  ["podStatePaused", "Pausiert", "Paused"],
  ["podStateInterjecting", "Zwischenfrage", "Question"],
  ["podStateAnswering", "Hosts antworten", "Hosts answering"],
  ["podStateResuming", "Wird fortgesetzt", "Resuming"],
  ["podStateError", "Fehler", "Error"],
  ["audioRetry", "Erneut versuchen", "Try again"],

  // Bühne und Transkript
  ["stageEyebrow", "Deep Dive", "Deep Dive"],
  ["stageJoin", "Beitreten / Frage an die Hosts stellen", "Join / ask the hosts a question"],
  [
    "stageNote",
    "Live-Audio-Synthese · Antworten mit Quellenangabe",
    "Live audio synthesis · answers with source references"
  ],
  ["lyricsLabel", "Live Transkript und Songtexte", "Live transcript and lyrics"],

  // Anwendungsleiste und Spalten (Issue #325)
  ["titleEditHint", "Zum Umbenennen auswählen", "Select to rename"],
  ["titleInputLabel", "Notebook-Titel", "Notebook title"],
  ["titleSaved", "Titel gespeichert: {title}", "Title saved: {title}"],
  ["skipToSources", "Zu den Quellen", "Skip to sources"],
  ["skipToChat", "Zum Chat", "Skip to chat"],
  ["skipToStudio", "Zum Studio", "Skip to Studio"],
  ["panelCollapseSources", "Quellen einklappen", "Collapse sources"],
  ["panelExpandSources", "Quellen ausklappen", "Expand sources"],
  ["panelCollapseStudio", "Studio einklappen", "Collapse Studio"],
  ["panelExpandStudio", "Studio ausklappen", "Expand Studio"],
  ["panelSourcesCollapsed", "Quellen eingeklappt", "Sources collapsed"],
  ["panelSourcesExpanded", "Quellen ausgeklappt", "Sources expanded"],
  ["panelStudioCollapsed", "Studio eingeklappt", "Studio collapsed"],
  ["panelStudioExpanded", "Studio ausgeklappt", "Studio expanded"],
  ["shortcutSources", "Alt+Umschalt+1", "Alt+Shift+1"],
  ["shortcutStudio", "Alt+Umschalt+3", "Alt+Shift+3"],
  ["railSourcesLabel", "Quellen (eingeklappt)", "Sources (collapsed)"],
  ["railStudioLabel", "Studio (eingeklappt)", "Studio (collapsed)"],
  ["shareButton", "Teilen", "Share"],
  ["shareTitle", "„{title}“ teilen", "Share “{title}”"],
  ["shareClose", "Teilen schließen", "Close sharing"],
  ["shareNoticeTitle", "Freigabe noch nicht verfügbar", "Sharing not available yet"],
  [
    "shareNotice",
    "So wird das Teilen später aussehen. Einladungen werden noch nicht verschickt, und niemand außer Ihnen erhält Zugriff.",
    "This is how sharing will look. Invitations are not sent yet, and nobody but you gets access."
  ],
  ["shareEmailLabel", "E-Mail-Adresse", "Email address"],
  ["shareEmailPlaceholder", "name@beispiel.de", "name@example.com"],
  ["shareRoleLabel", "Rolle", "Role"],
  ["shareRoleOwner", "Eigentümer", "Owner"],
  ["shareRoleEditor", "Bearbeiten", "Can edit"],
  ["shareRoleViewer", "Betrachten", "Can view"],
  ["shareSend", "Einladung senden", "Send invitation"],
  ["shareSendSoon", "Bald verfügbar", "Coming soon"],
  [
    "shareSendUnavailable",
    "Nicht gesendet: Die Freigabe ist noch nicht verfügbar.",
    "Not sent: sharing is not available yet."
  ],
  ["sharePeopleTitle", "Personen mit Zugriff", "People with access"],
  ["shareGuestYou", "Gast (Sie)", "Guest (you)"],
  ["shareDone", "Fertig", "Done"],
  ["shareMenuHint", "Freigabe noch nicht verfügbar", "Sharing not available yet"],
  ["accountButton", "Konto", "Account"],
  ["accountGuest", "Gast", "Guest"],
  ["accountSignedOut", "Nicht angemeldet", "Not signed in"],
  [
    "accountText",
    "Anmelden ist noch nicht möglich. Titel, Darstellung und Einstellungen bleiben auf diesem Gerät gespeichert.",
    "Signing in is not available yet. Title, appearance and settings stay saved on this device."
  ],
  ["accountOpenSettings", "Einstellungen öffnen", "Open settings"],

  // Wissensgraph (Issue #327)
  ["navGraph", "Graph", "Graph"],
  ["navGraphAria", "Graph der Begriffe und Quellen", "Graph of concepts and sources"],
  ["toolGraphTitle", "Wissensgraph", "Knowledge graph"],
  [
    "toolGraphDesc",
    "Zeigt, welche Begriffe in welchen Quellen vorkommen und wie sie zusammenhängen.",
    "Shows which concepts appear in which sources and how they connect."
  ],
  ["toolGraphOpen", "Anzeigen", "Show"],
  ["graphTitle", "Wissensgraph", "Knowledge graph"],
  [
    "graphSub",
    "{concepts} Begriffe, {sources} Quellen, {links} Verbindungen",
    "{concepts} concepts, {sources} sources, {links} links"
  ],
  ["graphBack", "Zurück zum Chat", "Back to chat"],
  ["graphTabList", "Liste", "List"],
  ["graphSvgLabel", "Wissensgraph als Grafik", "Knowledge graph as a graphic"],
  [
    "graphVisualHint",
    "Pfeiltasten wechseln zwischen den Knoten, Eingabe oder Leertaste zeigt die Details. Die Liste enthält denselben Inhalt als Text.",
    "Arrow keys move between nodes, Enter or Space shows the details. The list holds the same content as text."
  ],
  ["graphKindConcept", "Begriff", "Concept"],
  ["graphKindSource", "Quelle", "Source"],
  ["graphNodeAria", "{label}, {kind}, {n} Verbindungen", "{label}, {kind}, {n} links"],
  ["graphLegendLabel", "Legende", "Legend"],
  ["graphLegendRelated", "Durchgezogen: hängt zusammen mit", "Solid: related to"],
  ["graphLegendOccurs", "Gestrichelt: kommt vor in", "Dashed: appears in"],
  ["graphLegendConcept", "Abgerundet: Begriff", "Rounded: concept"],
  ["graphLegendSource", "Eckig: Quelle", "Square: source"],
  ["graphRelated", "Hängt zusammen mit", "Related to"],
  ["graphOccursIn", "Kommt vor in", "Appears in"],
  ["graphContains", "Enthält die Begriffe", "Contains the concepts"],
  ["graphNone", "keine", "none"],
  ["graphShowSource", "Quelle anzeigen", "Show source"],
  ["graphShowSourceAria", "Quelle anzeigen: {title}", "Show source: {title}"],
  ["graphDetailsTitle", "Details", "Details"],
  [
    "graphDetailsEmpty",
    "Wählen Sie einen Knoten, um seine Verbindungen zu sehen.",
    "Select a node to see its links."
  ],
  ["graphSelected", "Ausgewählt: {label}", "Selected: {label}"],
  ["graphListConcepts", "Begriffe", "Concepts"],
  ["graphListSources", "Quellen", "Sources"],
  [
    "graphEmpty",
    "Noch keine Begriffe oder Quellen. Fügen Sie Quellen hinzu.",
    "No concepts or sources yet. Add sources."
  ],
  // Komponenten (Issue #329): Ansichten, Leerzustände, Hinweis-Leiste
  ["viewToggleSources", "Ansicht der Quellen", "Source view"],
  ["viewList", "Liste", "List"],
  ["viewCards", "Karten", "Cards"],
  ["viewTable", "Tabelle", "Table"],
  ["srcEmptyNoneTitle", "Noch keine Quellen", "No sources yet"],
  [
    "srcEmptyNoneText",
    "Laden Sie PDF-, Text- oder Markdown-Dateien hoch oder fügen Sie einen Link hinzu. Antworten stützen sich nur auf diese Quellen.",
    "Upload PDF, text or Markdown files, or add a link. Answers rely on these sources only."
  ],
  ["srcEmptyFilterTitle", "Kein Treffer", "No match"],
  [
    "srcEmptyFilterText",
    "Keine Quelle passt zu „{query}“. Prüfen Sie die Schreibweise oder leeren Sie den Filter.",
    "No source matches “{query}”. Check the spelling or clear the filter."
  ],
  ["srcClearFilter", "Filter leeren", "Clear filter"],
  ["chatEmptyTitle", "Noch keine Fragen", "No questions yet"],
  [
    "chatEmptyText",
    "Fragen Sie etwas zu Ihren Quellen oder wählen Sie einen Vorschlag. Jede Antwort zeigt mit Nummern, woher sie stammt.",
    "Ask something about your sources or pick a suggestion. Each answer shows its sources as numbers."
  ],
  ["studioNoSourcesTitle", "Keine Quelle ausgewählt", "No source selected"],
  [
    "studioNoSourcesText",
    "Wählen Sie im Bereich Quellen mindestens eine Quelle aus. Daraus entstehen Überblicke, Karten und Quiz.",
    "Select at least one source in the Sources area. Overviews, cards and quizzes are built from it."
  ],
  ["studioMoreTools", "Weitere Werkzeuge", "More tools"],
  ["notesEmptyTitle", "Noch keine Notizen", "No notes yet"],
  [
    "notesEmptyText",
    "Gespeicherte Antworten und eigene Notizen erscheinen hier.",
    "Saved answers and your own notes appear here."
  ],
  ["quizEmptyTitle", "Noch kein Quiz", "No quiz yet"],
  ["cardsEmptyTitle", "Noch keine Lernkarten", "No flashcards yet"],
  ["quizResultsTitle", "Antworten im Überblick", "Answers at a glance"],
  ["quizResultsView", "Ansicht der Antworten", "Answer view"],
  ["quizColQuestion", "Frage", "Question"],
  ["quizColYours", "Ihre Antwort", "Your answer"],
  ["quizColCorrect", "Richtige Antwort", "Correct answer"],
  ["quizNoAnswer", "Nicht beantwortet", "Not answered"],
  ["toastClose", "Hinweis schließen", "Dismiss notice"],
  ["toastSourceAdded", "Quelle hinzugefügt: {title}", "Source added: {title}"],
  ["toastSourcesAdded", "{n} Quellen hinzugefügt", "{n} sources added"],
  ["toastDownload", "Download gestartet: {file}", "Download started: {file}"]

  // Rollen
];

function pick(index: 1 | 2): Record<string, string> {
  return Object.fromEntries(ENTRIES.map((entry) => [entry[0], entry[index] as string]));
}

export const AREA_DE: Readonly<Record<string, string>> = pick(1);
export const AREA_EN: Readonly<Record<string, string>> = pick(2);
