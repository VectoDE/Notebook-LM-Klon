/**
 * Eine Symbolfamilie für die ganze Oberfläche (Issue #328: gefüllte Symbole).
 *
 * 24er-Raster, Farbe über currentColor. Jedes Symbol mit Fläche ist gefüllt (`fill`,
 * Füllregel evenodd; Aussparungen zeichnen Details wie Zeilen oder das Abspielzeichen).
 * Reine Linienzeichen ohne Fläche (Kreuz, Haken, Menü, Winkel, Kette, Pegel, Wellen)
 * stehen als kräftige Linie mit runden Enden (`line`, Strich 2).
 * Symbole sind Schmuck (aria-hidden); die Bedeutung trägt immer der sichtbare Text oder
 * ein aria-label am Bedienelement.
 */
export interface IconShape {
  /** Gefüllte Fläche (evenodd) */
  readonly fill?: string;
  /** Linie ohne Fläche (Strich 2, runde Enden) */
  readonly line?: string;
}

const PAGE =
  "M7 3h6.5v4.5A1.5 1.5 0 0 0 15 9h4v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM15 3.4 18.6 7H15V3.4Z";

const SHAPES = {
  upload: {
    fill: "M12 3 17.5 8.5h-4.25V15h-2.5V8.5H6.5L12 3ZM4 14h2.25v3.75h11.5V14H20v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4Z"
  },
  link: {
    line: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"
  },
  search: {
    fill: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Zm0 2.75a4.75 4.75 0 1 1 0 9.5 4.75 4.75 0 0 1 0-9.5Z",
    line: "m16.25 16.25 4.25 4.25"
  },
  send: { fill: "M12 3.5 19 10.5h-5.5V20h-3v-9.5H5L12 3.5Z" },
  stop: { fill: "M7 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" },
  settings: {
    fill: "M15 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Zm-6 6a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Zm8 6a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z",
    line: "M4 6h8M18 6h2M4 12h2M12 12h8M4 18h10"
  },
  sources: { fill: `${PAGE}M8.5 12.25h7v1.5h-7v-1.5Zm0 3.5h4.5v1.5H8.5v-1.5Z` },
  chat: {
    fill: "M20 12a8 8 0 0 1-11.6 7.1L4 20l.9-4.4A8 8 0 1 1 20 12ZM8.5 10.25h7v1.5h-7v-1.5Zm0 3.5h4.5v1.5H8.5v-1.5Z"
  },
  studio: {
    fill: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Zm6 12 .8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z"
  },
  audio: { line: "M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" },
  video: {
    fill: "M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm4.5 5v6l5-3-5-3Z"
  },
  mindmap: {
    fill: "M12 3.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm-6 11a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm12 0a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z",
    line: "M10.6 9.2 7.4 14.8m6-5.6 3.2 5.6"
  },
  cards: {
    fill: "M6 7h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z",
    line: "M8 4h10a2 2 0 0 1 2 2v10"
  },
  quiz: {
    fill: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-4.6 9.1 1.4-1.4 2.2 2.2 4.2-4.2 1.4 1.4-5.6 5.6-3.6-3.6Z"
  },
  briefing: {
    fill: "M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm3 4.25h6v1.5H9v-1.5Zm0 4h6v1.5H9v-1.5Zm0 4h3v1.5H9v-1.5Z"
  },
  back: { fill: "M3.5 12 10.5 5v5.5H20v3h-9.5V19L3.5 12Z" },
  close: { line: "M6 6l12 12M18 6 6 18" },
  eye: {
    fill: "M12 5c6 0 9.5 7 9.5 7s-3.5 7-9.5 7-9.5-7-9.5-7S6 5 12 5Zm0 3.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0 2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z"
  },
  download: { fill: "M10.5 3h3v8.5H18L12 17.5 6 11.5h4.5V3ZM5 19h14v2H5v-2Z" },
  chevron: { line: "m6 9 6 6 6-6" },
  speaker: {
    fill: "M3 9h4l5.5-4.5v15L7 15H3V9Z",
    line: "M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"
  },
  stage: {
    fill: "M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z",
    line: "M8 20h8M12 16v4"
  },
  file: { fill: PAGE },
  palette: {
    fill: "M12 21a9 9 0 1 1 9-9c0 2.2-1.8 3.5-3.6 3.5H15a2 2 0 0 0-1.4 3.4A1.3 1.3 0 0 1 12 21ZM7.5 10.25a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5ZM10 6.25a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm4.5 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z"
  },
  contrast: { fill: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 2a7 7 0 0 1 0 14V5Z" },
  menu: { line: "M4 7h16M4 12h16M4 17h16" },
  check: { line: "m5 12.5 4.5 4.5L19 7.5" },
  panelLeft: {
    fill: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm5 2v12h8.5a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5H10Z"
  },
  panelRight: {
    fill: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm.5 2a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5H14V6H5.5Z"
  },
  share: {
    fill: "M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM3 19a6 6 0 0 1 12 0v1H3v-1Z",
    line: "M19 8v6m3-3h-6"
  },
  account: {
    fill: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm-5.4 11.8a6.5 6.5 0 0 1 10.8 0 7.5 7.5 0 0 1-10.8 0Z"
  },
  edit: {
    fill: "M4 16 14.5 5.5l4 4L8 20H4v-4ZM16 4l1-1a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2l-1 1-4-4Z"
  },
  plus: { line: "M12 5v14M5 12h14" }
} as const satisfies Record<string, IconShape>;

export type IconName = keyof typeof SHAPES;

export const ICON_NAMES = Object.keys(SHAPES) as IconName[];

/** Form eines Symbols (Fläche und/oder Linie), z. B. für Tests. */
export function iconShape(name: IconName): IconShape {
  return SHAPES[name];
}

export interface IconProps {
  readonly name: IconName;
  readonly size?: number | undefined;
  readonly className?: string | undefined;
}

export function Icon({ name, size = 20, className = "rn-icon" }: IconProps) {
  const shape: IconShape = SHAPES[name];
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      {shape.fill && <path d={shape.fill} fill="currentColor" fillRule="evenodd" />}
      {shape.line && (
        <path
          d={shape.line}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
