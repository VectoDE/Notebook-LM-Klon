/**
 * Theme Context, Hook, and I18n Engine for 4 Design Systems x 3 Color Modes x 2 Languages.
 *
 * Implements Sub-Issue #128 & #129:
 * - 4 Design Systems: pure, immersive-cinema, editorial-calm, fusion
 * - 3 Color Modes: light, dark, aaa-contrast, dazu "system" (Standard, folgt dem Gerät live)
 * - 2 Languages: de, en
 * - Persistence in localStorage and html attributes (data-design, data-color-mode, lang)
 */

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";

import { COLOR_MODES, type ColorMode, type DesignTheme, THEMES } from "./design-tokens.js";
import {
  COLOR_MODE_PREFERENCES,
  type ColorModePreference,
  LANGUAGES,
  type Language,
  SYSTEM_COLOR_QUERIES,
  applyThemeToDocument,
  resolveColorMode,
  resolveInitialPreferences,
  systemColorMode
} from "./theme-preferences.js";

export { COLOR_MODES, COLOR_MODE_PREFERENCES, LANGUAGES, THEMES };
export type { ColorMode, ColorModePreference, DesignTheme, Language };

export interface TranslationDictionary {
  readonly [key: string]: string;
}

export const TRANSLATIONS: Record<Language, TranslationDictionary> = {
  de: {
    appTitle: "RelationNotes - NotebookLM & RelationFlow Knowledge Studio",
    appSubtitle:
      "Bereit für Forschung, Quellenanalyse, Wissengraphen und barrierefreie Studio-Synthese.",
    sourcesTitle: "Quellen",
    sourcesEmpty: "Noch keine Quellen hochgeladen.",
    sourcesAdd: "Quelle hinzufügen",
    sourcesCount: "Quellen",
    chatTitle: "Chat & Zitate",
    chatPlaceholder: "Frage zu den Quellen stellen oder Thema vertiefen...",
    chatSend: "Frage senden",
    chatDisclaimer:
      "Antworten sind KI-generiert und können Fehler enthalten. Bitte Quellen prüfen.",
    studioTitle: "Studio",
    studioAudioCard: "Audio-Overview (Deep Dive)",
    studioVideoCard: "Video-Overview",
    studioMindmapCard: "Wissens-Mindmap",
    studioFlashcardsCard: "Lernkarten (SM-2)",
    studioQuizCard: "Interaktives Quiz",
    studioBriefingCard: "Briefing & Timeline",
    settingsTitle: "Einstellungen",
    settingsClose: "Einstellungen schließen",
    appearanceTitle: "Darstellung",
    appearanceStored: "Design und Farbschema werden auf diesem Gerät gespeichert.",
    themeLabel: "Design",
    colorModeLabel: "Farbschema",
    languageLabel: "Sprache",
    languageHint: "Gilt für die Oberfläche und wird auf diesem Gerät gespeichert.",
    modelRouter: "KI-Modell",
    modelHint: "Gilt für neue Antworten.",
    byokTitle: "Eigene API-Schlüssel (BYOK)",
    byokStatus: "In Vorbereitung",
    byokText:
      "Bald können Sie hier eigene Schlüssel für Modellanbieter hinterlegen. Sie werden verschlüsselt gespeichert.",
    gdprTitle: "DSGVO & Datenschutz",
    gdprText: "Alle Verarbeitungen erfolgen datensparsam und EU-DSGVO-konform ohne Training.",
    aiActTitle: "EU AI Act",
    aiActBadge: "Transparenzpflicht Art. 50 erfüllt (Kennzeichnung KI-generierter Inhalte).",
    cinemaStageClose: "Bühne schließen",
    themePure: "Pure",
    themePureHint: "Ruhige Klarheit",
    themeEditorial: "Editorial",
    themeEditorialHint: "Lesen mit Serife",
    themeCinema: "Cinema",
    themeCinemaHint: "Tiefe und Licht",
    themeFusion: "Fusion",
    themeFusionHint: "Energie und Farbe",
    modeSystem: "Automatisch (wie Gerät)",
    modeLight: "Hell",
    modeDark: "Dunkel",
    modeAAA: "Hoher Kontrast (AAA)",
    motionLabel: "Reduzierte Bewegung",
    navOverview: "Übersicht",
    navMindmap: "Mindmap",
    navFlashcards: "Lernkarten",
    navQuiz: "Quiz",
    navVideo: "Video",
    navAudio: "Audio"
  },
  en: {
    appTitle: "RelationNotes - NotebookLM & RelationFlow Knowledge Studio",
    appSubtitle:
      "Ready for research, source grounding, knowledge graphs, and accessible synthesis.",
    sourcesTitle: "Sources",
    sourcesEmpty: "No sources uploaded yet.",
    sourcesAdd: "Add source",
    sourcesCount: "Sources",
    chatTitle: "Chat & Citations",
    chatPlaceholder: "Ask a question about your sources or explore a topic...",
    chatSend: "Send question",
    chatDisclaimer: "Responses are AI-generated and may contain errors. Please verify sources.",
    studioTitle: "Studio",
    studioAudioCard: "Audio Overview (Deep Dive)",
    studioVideoCard: "Video Overview",
    studioMindmapCard: "Knowledge Mindmap",
    studioFlashcardsCard: "Flashcards (SM-2)",
    studioQuizCard: "Interactive Quiz",
    studioBriefingCard: "Briefing & Timeline",
    settingsTitle: "Settings",
    settingsClose: "Close settings",
    appearanceTitle: "Appearance",
    appearanceStored: "Design and color scheme are saved on this device.",
    themeLabel: "Design",
    colorModeLabel: "Color scheme",
    languageLabel: "Language",
    languageHint: "Applies to the interface and is saved on this device.",
    modelRouter: "AI model",
    modelHint: "Applies to new answers.",
    byokTitle: "Your own API keys (BYOK)",
    byokStatus: "Coming soon",
    byokText:
      "Soon you can add your own keys for model providers here. They will be stored encrypted.",
    gdprTitle: "GDPR & Privacy",
    gdprText: "All processing complies strictly with EU GDPR standards with zero model training.",
    aiActTitle: "EU AI Act",
    aiActBadge: "Article 50 Transparency standard fulfilled (labeled AI-generated content).",
    cinemaStageClose: "Close Stage",
    themePure: "Pure",
    themePureHint: "Calm clarity",
    themeEditorial: "Editorial",
    themeEditorialHint: "Reading with serifs",
    themeCinema: "Cinema",
    themeCinemaHint: "Depth and light",
    themeFusion: "Fusion",
    themeFusionHint: "Energy and color",
    modeSystem: "Automatic (match device)",
    modeLight: "Light",
    modeDark: "Dark",
    modeAAA: "High contrast (AAA)",
    motionLabel: "Reduced Motion",
    navOverview: "Overview",
    navMindmap: "Mindmap",
    navFlashcards: "Flashcards",
    navQuiz: "Quiz",
    navVideo: "Video",
    navAudio: "Audio"
  }
};

export interface ThemeContextValue {
  readonly theme: DesignTheme;
  /** Gewählter Farbmodus, ggf. "system". */
  readonly colorMode: ColorModePreference;
  /** Tatsächlich angewendeter Farbmodus (bei "system" der des Geräts). */
  readonly resolvedColorMode: ColorMode;
  readonly language: Language;
  readonly setTheme: (theme: DesignTheme) => void;
  readonly setColorMode: (mode: ColorModePreference) => void;
  readonly setLanguage: (lang: Language) => void;
  readonly t: (key: string) => string;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  readonly children: ReactNode;
  readonly defaultTheme?: DesignTheme | undefined;
  readonly defaultColorMode?: ColorModePreference | undefined;
  readonly defaultLanguage?: Language | undefined;
}

function browserEnvironment() {
  if (typeof window === "undefined") return {};
  let storage: Storage | undefined;
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }
  return {
    storage,
    matchMedia: typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : undefined
  };
}

export function ThemeProvider({
  children,
  defaultTheme,
  defaultColorMode,
  defaultLanguage
}: ThemeProviderProps) {
  const [initial] = useState(() =>
    resolveInitialPreferences(browserEnvironment(), {
      theme: defaultTheme,
      colorMode: defaultColorMode,
      language: defaultLanguage
    })
  );
  const [theme, setThemeState] = useState<DesignTheme>(initial.theme);
  const [colorMode, setColorModeState] = useState<ColorModePreference>(initial.colorMode);
  const [language, setLanguageState] = useState<Language>(initial.language);
  const [systemMode, setSystemMode] = useState<ColorMode>(() =>
    systemColorMode(browserEnvironment())
  );

  // Modus "system": live auf Änderungen von Farbschema und Kontrast des Geräts reagieren
  useEffect(() => {
    if (colorMode !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const lists = SYSTEM_COLOR_QUERIES.map((q) => window.matchMedia(q));
    const update = () => setSystemMode(systemColorMode(browserEnvironment()));
    update();
    for (const list of lists) list.addEventListener("change", update);
    return () => {
      for (const list of lists) list.removeEventListener("change", update);
    };
  }, [colorMode]);

  const resolvedColorMode = resolveColorMode(colorMode, systemMode);

  // Zustand in DOM-Attribute und localStorage spiegeln
  useEffect(() => {
    if (typeof document === "undefined") return;
    applyThemeToDocument(
      document.documentElement,
      { theme, colorMode, language },
      browserEnvironment().storage,
      systemMode
    );
  }, [theme, colorMode, language, systemMode]);

  const setTheme = useCallback((newTheme: DesignTheme) => {
    setThemeState(newTheme);
  }, []);

  const setColorMode = useCallback((newMode: ColorModePreference) => {
    setColorModeState(newMode);
  }, []);

  const setLanguage = useCallback((newLang: Language) => {
    setLanguageState(newLang);
  }, []);

  const t = useCallback(
    (key: string): string => {
      const dict = TRANSLATIONS[language];
      return dict[key] ?? TRANSLATIONS.de[key] ?? key;
    },
    [language]
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      colorMode,
      resolvedColorMode,
      language,
      setTheme,
      setColorMode,
      setLanguage,
      t
    }),
    [theme, colorMode, resolvedColorMode, language, setTheme, setColorMode, setLanguage, t]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    return {
      theme: "fusion",
      colorMode: "system",
      resolvedColorMode: "light",
      language: "de",
      setTheme: () => {},
      setColorMode: () => {},
      setLanguage: () => {},
      t: (key: string) => TRANSLATIONS.de[key] ?? key
    };
  }
  return context;
}
