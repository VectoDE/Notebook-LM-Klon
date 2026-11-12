/**
 * Eine Symbolfamilie für die ganze Oberfläche: 24er-Raster, Strich 1,75, runde Enden,
 * Farbe über currentColor. Symbole sind Schmuck (aria-hidden); die Bedeutung trägt
 * immer der sichtbare Text oder ein aria-label am Bedienelement.
 */
const PATHS = {
  upload: "M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3",
  link: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 2-4.2-4.2",
  send: "M12 19V5m0 0-6 6m6-6 6 6",
  stop: "M8 7h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z",
  settings: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4",
  sources: "M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm7 0v5h5M9 13h6M9 17h4",
  chat: "M20 12a8 8 0 0 1-11.6 7.1L4 20l.9-4.4A8 8 0 1 1 20 12ZM9 11h6M9 14.5h4",
  studio:
    "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Zm6 12 .8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z",
  audio: "M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2",
  video: "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Zm6.5 3v6l5-3-5-3Z",
  mindmap:
    "M12 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm-6 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm12 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM10.6 9.2 7.4 14.8m6-5.6 3.2 5.6",
  cards:
    "M8 4h10a2 2 0 0 1 2 2v10M4 9a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9Z",
  quiz: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-3.5-9 2.5 2.5 5-5",
  briefing:
    "M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm3 5h6M9 12h6M9 16h3",
  back: "M19 12H5m0 0 6-6m-6 6 6 6",
  close: "M6 6l12 12M18 6 6 18",
  eye: "M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  download: "M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 20h14",
  chevron: "m6 9 6 6 6-6",
  speaker: "M4 9v6h4l5 4V5L8 9H4Zm12.5-.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12",
  stage: "M3 5h18v11H3V5Zm5 15h8M12 16v4",
  file: "M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm7 0v5h5",
  palette:
    "M12 21a9 9 0 1 1 9-9c0 2.2-1.8 3.5-3.6 3.5H15a2 2 0 0 0-1.4 3.4A1.3 1.3 0 0 1 12 21ZM7.5 11.5h.01M10 7.5h.01M14.5 7.5h.01",
  contrast: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-18v18"
} as const;

export type IconName = keyof typeof PATHS;

export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export interface IconProps {
  readonly name: IconName;
  readonly size?: number | undefined;
  readonly className?: string | undefined;
}

export function Icon({ name, size = 20, className = "rn-icon" }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
