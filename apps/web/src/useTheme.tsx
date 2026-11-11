/**
 * Theme Context, Hook, and I18n Engine for 4 Design Systems x 3 Color Modes x 2 Languages.
 *
 * Implements Sub-Issue #128 & #129:
 * - 4 Design Systems: pure, immersive-cinema, editorial-calm, fusion
 * - 3 Color Modes: light, dark, aaa-contrast (Standard folgt der Systemeinstellung)
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
  LANGUAGES,
  type Language,
  applyThemeToDocument,
  resolveInitialPreferences
} from "./theme-preferences.js";

export { COLOR_MODES, LANGUAGES, THEMES };
export type { ColorMode, DesignTheme, Language };

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
    settingsTitle: "Einstellungen & Compliance",
    settingsClose: "Schließen",
    themeLabel: "Design-System",
    colorModeLabel: "Farbschema",
    languageLabel: "Sprache",
    modelRouter: "Modell-Router",
    byokTitle: "BYOK (Bring Your Own Key)",
    gdprTitle: "DSGVO & Datenschutz",
    gdprText: "Alle Verarbeitungen erfolgen datensparsam und EU-DSGVO-konform ohne Training.",
    aiActTitle: "EU AI Act Compliance",
    aiActBadge: "Transparenzpflicht Art. 50 erfüllt (Kennzeichnung KI-generierter Inhalte).",
    cinemaStageClose: "Bühne schließen",
    themePure: "Pure",
    themeCinema: "Immersive Cinema",
    themeEditorial: "Editorial Calm",
    themeFusion: "Fusion (Standard)",
    modeLight: "Hell",
    modeDark: "Dunkel",
    modeAAA: "Hochkontrast (AAA)",
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
    settingsTitle: "Settings & Compliance",
    settingsClose: "Close",
    themeLabel: "Design System",
    colorModeLabel: "Color Mode",
    languageLabel: "Language",
    modelRouter: "Model Router",
    byokTitle: "BYOK (Bring Your Own Key)",
    gdprTitle: "GDPR & Privacy",
    gdprText: "All processing complies strictly with EU GDPR standards with zero model training.",
    aiActTitle: "EU AI Act Compliance",
    aiActBadge: "Article 50 Transparency standard fulfilled (labeled AI-generated content).",
    cinemaStageClose: "Close Stage",
    themePure: "Pure",
    themeCinema: "Immersive Cinema",
    themeEditorial: "Editorial Calm",
    themeFusion: "Fusion (Default)",
    modeLight: "Light",
    modeDark: "Dark",
    modeAAA: "High Contrast (AAA)",
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
  readonly colorMode: ColorMode;
  readonly language: Language;
  readonly setTheme: (theme: DesignTheme) => void;
  readonly setColorMode: (mode: ColorMode) => void;
  readonly setLanguage: (lang: Language) => void;
  readonly t: (key: string) => string;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  readonly children: ReactNode;
  readonly defaultTheme?: DesignTheme | undefined;
  readonly defaultColorMode?: ColorMode | undefined;
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
  const [colorMode, setColorModeState] = useState<ColorMode>(initial.colorMode);
  const [language, setLanguageState] = useState<Language>(initial.language);

  // Zustand in DOM-Attribute und localStorage spiegeln
  useEffect(() => {
    if (typeof document === "undefined") return;
    applyThemeToDocument(
      document.documentElement,
      { theme, colorMode, language },
      browserEnvironment().storage
    );
  }, [theme, colorMode, language]);

  const setTheme = useCallback((newTheme: DesignTheme) => {
    setThemeState(newTheme);
  }, []);

  const setColorMode = useCallback((newMode: ColorMode) => {
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
      language,
      setTheme,
      setColorMode,
      setLanguage,
      t
    }),
    [theme, colorMode, language, setTheme, setColorMode, setLanguage, t]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    return {
      theme: "fusion",
      colorMode: "light",
      language: "de",
      setTheme: () => {},
      setColorMode: () => {},
      setLanguage: () => {},
      t: (key: string) => TRANSLATIONS.de[key] ?? key
    };
  }
  return context;
}
