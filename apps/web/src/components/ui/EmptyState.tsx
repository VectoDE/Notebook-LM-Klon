import type { ReactNode } from "react";

/**
 * Leerer Zustand (Issue #329): eigene Zeichnung, Überschrift, ein Satz, der sagt, was zu
 * tun ist, und auf Wunsch eine Aktion. Die Zeichnung ist Schmuck (aria-hidden), die
 * Bedeutung tragen Überschrift und Text. Farben kommen aus den Design-Tokens per Klasse.
 */
export type EmptyStateArt = "sources" | "filter" | "chat" | "studio" | "notes";

export interface EmptyStateProps {
  readonly art: EmptyStateArt;
  readonly title: string;
  readonly text: string;
  /** Überschriftenebene passend zur Umgebung. */
  readonly headingLevel?: 2 | 3 | 4 | undefined;
  /** Kleinere Darstellung, z. B. innerhalb einer Liste. */
  readonly compact?: boolean | undefined;
  readonly children?: ReactNode | undefined;
  readonly testId?: string | undefined;
  readonly lang?: string | undefined;
}

export function EmptyState({
  art,
  title,
  text,
  headingLevel = 3,
  compact = false,
  children,
  testId,
  lang
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  return (
    <div
      className={`rn-empty${compact ? " rn-empty--compact" : ""}`}
      data-testid={testId}
      data-art={art}
      lang={lang}
    >
      <EmptyArt art={art} />
      <Heading className="rn-empty-title">{title}</Heading>
      <p className="rn-empty-text">{text}</p>
      {children && <div className="rn-empty-actions">{children}</div>}
    </div>
  );
}

/** Darstellungsbreite der Zeichnung in px (Issue #356: groß, 240 bis 320 px). */
export const EMPTY_ART_WIDTH = 280;

/**
 * Zeichnungen im 120 × 88-Raster: Fläche, Linie, ein Akzent. Dargestellt in 280 px Breite
 * (kompakt 240 px), auf schmalen Flächen schrumpft sie mit; Linien behalten per
 * non-scaling-stroke ihre Stärke in Bildschirmpixeln.
 */
export function EmptyArt({ art }: { readonly art: EmptyStateArt }) {
  return (
    <svg
      className="rn-empty-art"
      viewBox="0 0 120 88"
      width={EMPTY_ART_WIDTH}
      height={Math.round((EMPTY_ART_WIDTH * 88) / 120)}
      aria-hidden="true"
      focusable="false"
    >
      <ellipse className="rn-art-ground" cx="60" cy="80" rx="44" ry="5" />
      {ART[art]}
    </svg>
  );
}

const ART: Readonly<Record<EmptyStateArt, ReactNode>> = {
  // Zwei Blätter, das vordere mit Eselsohr und Zeilen, darüber ein Plus
  sources: (
    <>
      <rect className="rn-art-fill" x="30" y="14" width="40" height="52" rx="5" />
      <rect className="rn-art-line" x="30" y="14" width="40" height="52" rx="5" />
      <path
        className="rn-art-paper"
        d="M44 22h24l10 10v42a4 4 0 0 1-4 4H44a4 4 0 0 1-4-4V26a4 4 0 0 1 4-4Z"
      />
      <path
        className="rn-art-line"
        d="M44 22h24l10 10v42a4 4 0 0 1-4 4H44a4 4 0 0 1-4-4V26a4 4 0 0 1 4-4Z"
      />
      <path className="rn-art-line" d="M68 22v10h10M48 44h22M48 52h22M48 60h14" />
      <circle className="rn-art-accent" cx="86" cy="22" r="11" />
      <path className="rn-art-on-accent" d="M86 16.5v11M80.5 22h11" />
    </>
  ),
  // Lupe über einem Blatt mit gestrichelten Zeilen: nichts gefunden
  filter: (
    <>
      <path
        className="rn-art-paper"
        d="M36 14h30l10 10v46a4 4 0 0 1-4 4H36a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4Z"
      />
      <path
        className="rn-art-line"
        d="M36 14h30l10 10v46a4 4 0 0 1-4 4H36a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4Z"
      />
      <path className="rn-art-line rn-art-dashed" d="M40 36h26M40 46h20M40 56h24" />
      <circle className="rn-art-fill" cx="78" cy="52" r="14" />
      <circle className="rn-art-line rn-art-strong" cx="78" cy="52" r="14" />
      <path className="rn-art-line rn-art-strong" d="m88 62 10 10" />
      <path className="rn-art-accent-line" d="m73 47 10 10m0-10-10 10" />
    </>
  ),
  // Frage rechts, Antwort links mit nummerierter Zitat-Pille
  chat: (
    <>
      <path
        className="rn-art-fill"
        d="M18 22a8 8 0 0 1 8-8h40a8 8 0 0 1 8 8v20a8 8 0 0 1-8 8H34l-10 8v-8a8 8 0 0 1-6-8V22Z"
      />
      <path
        className="rn-art-line"
        d="M18 22a8 8 0 0 1 8-8h40a8 8 0 0 1 8 8v20a8 8 0 0 1-8 8H34l-10 8v-8a8 8 0 0 1-6-8V22Z"
      />
      <path className="rn-art-line" d="M28 27h30M28 36h20" />
      <rect className="rn-art-accent" x="52" y="30" width="14" height="11" rx="5.5" />
      <path className="rn-art-on-accent" d="M58.6 33v5" />
      <path
        className="rn-art-accent-soft"
        d="M58 44a7 7 0 0 1 7-7h32a7 7 0 0 1 7 7v12a7 7 0 0 1-7 7h-4v7l-9-7H65a7 7 0 0 1-7-7V44Z"
      />
      <path
        className="rn-art-line"
        d="M58 44a7 7 0 0 1 7-7h32a7 7 0 0 1 7 7v12a7 7 0 0 1-7 7h-4v7l-9-7H65a7 7 0 0 1-7-7V44Z"
      />
      <path className="rn-art-line" d="M68 48h26M68 55h14" />
    </>
  ),
  // Aufgefächerte Werkzeuge: Karte, Klangwelle, Haken
  studio: (
    <>
      <rect
        className="rn-art-fill"
        x="22"
        y="24"
        width="34"
        height="44"
        rx="6"
        transform="rotate(-10 39 46)"
      />
      <rect
        className="rn-art-line"
        x="22"
        y="24"
        width="34"
        height="44"
        rx="6"
        transform="rotate(-10 39 46)"
      />
      <rect
        className="rn-art-fill"
        x="64"
        y="24"
        width="34"
        height="44"
        rx="6"
        transform="rotate(10 81 46)"
      />
      <rect
        className="rn-art-line"
        x="64"
        y="24"
        width="34"
        height="44"
        rx="6"
        transform="rotate(10 81 46)"
      />
      <path className="rn-art-line" d="m74 42 5 5 9-10" transform="rotate(10 81 46)" />
      <rect className="rn-art-accent" x="42" y="12" width="36" height="50" rx="7" />
      <path className="rn-art-on-accent" d="M50 37v6M55 32v16M60 27v26M65 33v14M70 36v8" />
    </>
  ),
  // Notizblock mit Stift
  notes: (
    <>
      <rect className="rn-art-paper" x="30" y="14" width="46" height="60" rx="6" />
      <rect className="rn-art-line" x="30" y="14" width="46" height="60" rx="6" />
      <path className="rn-art-line" d="M40 10v8M53 10v8M66 10v8M38 32h30M38 41h30M38 50h18" />
      <path className="rn-art-accent" d="m70 64 22-22 7 7-22 22-9 2 2-9Z" />
      <path className="rn-art-line" d="m70 64 22-22 7 7-22 22-9 2 2-9Z" />
    </>
  )
};
