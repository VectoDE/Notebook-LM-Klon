/**
 * Theme Context, Hook, and I18n Engine for 4 Design Systems x 3 Color Modes x 2 Languages.
 *
 * Implements Sub-Issue #128 & #129:
 * - 4 Design Systems: pure-notebooklm, immersive-cinema, editorial-calm, fusion
 * - 3 Color Modes: light, oled-dark, aaa-contrast
 * - 2 Languages: de, en
 * - Persistence in localStorage and html attributes (data-theme, data-color-mode, lang)
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

export type DesignTheme = "pure-notebooklm" | "immersive-cinema" | "editorial-calm" | "fusion";
export type ColorMode = "light" | "oled-dark" | "aaa-contrast";
export type Language = "de" | "en";

export const THEMES: readonly DesignTheme[] = [
  "pure-notebooklm",
  "immersive-cinema",
  "editorial-calm",
  "fusion"
] as const;

export const COLOR_MODES: readonly ColorMode[] = ["light", "oled-dark", "aaa-contrast"] as const;

export const LANGUAGES: readonly Language[] = ["de", "en"] as const;

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
    themePure: "Pure NotebookLM",
    themeCinema: "Immersive Cinema",
    themeEditorial: "Editorial Calm",
    themeFusion: "Fusion (Standard)",
    modeLight: "Hell",
    modeDark: "OLED Dunkel",
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
    themePure: "Pure NotebookLM",
    themeCinema: "Immersive Cinema",
    themeEditorial: "Editorial Calm",
    themeFusion: "Fusion (Default)",
    modeLight: "Light",
    modeDark: "OLED Dark",
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

const STORAGE_KEY_THEME = "rn_theme";
const STORAGE_KEY_COLOR_MODE = "rn_color_mode";
const STORAGE_KEY_LANGUAGE = "rn_language";

export interface ThemeProviderProps {
  readonly children: ReactNode;
  readonly defaultTheme?: DesignTheme | undefined;
  readonly defaultColorMode?: ColorMode | undefined;
  readonly defaultLanguage?: Language | undefined;
}

export function ThemeProvider({
  children,
  defaultTheme = "fusion",
  defaultColorMode = "light",
  defaultLanguage = "de"
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<DesignTheme>(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      const saved = window.localStorage.getItem(STORAGE_KEY_THEME) as DesignTheme | null;
      if (saved && THEMES.includes(saved)) {
        return saved;
      }
    }
    return defaultTheme;
  });

  const [colorMode, setColorModeState] = useState<ColorMode>(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      const saved = window.localStorage.getItem(STORAGE_KEY_COLOR_MODE) as ColorMode | null;
      if (saved && COLOR_MODES.includes(saved)) {
        return saved;
      }
    }
    return defaultColorMode;
  });

  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      const saved = window.localStorage.getItem(STORAGE_KEY_LANGUAGE) as Language | null;
      if (saved && LANGUAGES.includes(saved)) {
        return saved;
      }
    }
    return defaultLanguage;
  });

  // Sync state to DOM and localStorage
  useEffect(() => {
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.setAttribute("data-theme", theme);
      root.setAttribute("data-color-mode", colorMode);
      root.setAttribute("lang", language);
    }
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY_THEME, theme);
      window.localStorage.setItem(STORAGE_KEY_COLOR_MODE, colorMode);
      window.localStorage.setItem(STORAGE_KEY_LANGUAGE, language);
    }
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
