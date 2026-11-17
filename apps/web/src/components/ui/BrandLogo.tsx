/**
 * Logo C (Monogramm RN mit Wortmarke "RelationNotes"), Entscheidung "Logo C".
 *
 * Quelle: variante-c-monogramm.svg. Wortmarke als Pfade (keine Schrift nötig),
 * Farben aus Design-Tokens: Kachel --rn-color-logo-tile, "Relation" in Textfarbe,
 * "Notes" in --rn-color-logo-accent. Weiß in der Kachel bleibt fest.
 * Diese Datei wird aus der SVG-Quelle erzeugt; Änderungen an der Form dort vornehmen.
 */

import { useId } from "react";

export interface BrandLogoProps {
  /** Höhe in CSS-Pixeln; Breite folgt dem Seitenverhältnis 513,4 : 120. */
  readonly height?: number | undefined;
  /** Zugänglicher Name; Standard "RelationNotes". */
  readonly title?: string | undefined;
}

export const LOGO_ASPECT_RATIO = 513.4 / 120;

export function BrandLogo({ height = 32, title = "RelationNotes" }: BrandLogoProps) {
  const uid = useId().replace(/:/g, "");
  const bandId = `rn-logo-band-${uid}`;
  const baseId = `rn-logo-base-${uid}`;
  const titleId = `rn-logo-title-${uid}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 513.4 120"
      height={height}
      width={Math.round(height * LOGO_ASPECT_RATIO)}
      role="img"
      aria-labelledby={titleId}
      data-testid="brand-logo"
      style={{ display: "block", flexShrink: 0 }}
    >
      <title id={titleId}>{title}</title>
      <g transform="translate(12 12) scale(0.1875)">
        <rect width="512" height="512" rx="116" style={{ fill: "var(--rn-color-logo-tile)" }} />
        <defs>
          <clipPath id={bandId}>
            <rect x="0" y="150" width="512" height="212" />
          </clipPath>
        </defs>
        <g
          clipPath={`url(#${bandId})`}
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="40"
          strokeLinejoin="miter"
        >
          <path d="M118,400V120" />
          <path d="M98,170H168A48,48 0 0 1 168,266H98" />
          <path d="M160,266L282.3,380" />
        </g>
        <polygon
          fill="#FFFFFF"
          points="254,362 254,150 300,150 374,287.6 374,150 414,150 414,362 368,362 294,224.4 294,362"
        />
      </g>
      <defs>
        <clipPath id={baseId}>
          <rect x="-10" y="0" width="619.0" height="100" />
        </clipPath>
      </defs>
      <g transform="translate(130 19.70) scale(0.62)" clipPath={`url(#${baseId})`}>
        <g transform="translate(0.00 0)">
          <g
            fill="none"
            style={{ stroke: "var(--rn-color-text-primary)" }}
            strokeWidth="10"
            strokeLinecap="butt"
            strokeLinejoin="miter"
          >
            <path d="M5,100V30" />
            <path d="M0,35H26A17.5,17.5 0 0 1 26,70H0" />
            <path d="M22,70L50,106" />
          </g>
        </g>
        <g transform="translate(54.00 0)">
          <g
            fill="none"
            style={{ stroke: "var(--rn-color-text-primary)" }}
            strokeWidth="10"
            strokeLinecap="butt"
            strokeLinejoin="miter"
          >
            <path d="M5,75H45A20,20 0 1 0 39.4,88.8" />
          </g>
        </g>
        <g transform="translate(111.00 0)">
          <g
            fill="none"
            style={{ stroke: "var(--rn-color-text-primary)" }}
            strokeWidth="10"
            strokeLinecap="butt"
            strokeLinejoin="miter"
          >
            <path d="M5,25V100" />
          </g>
        </g>
        <g transform="translate(128.00 0)">
          <g
            fill="none"
            style={{ stroke: "var(--rn-color-text-primary)" }}
            strokeWidth="10"
            strokeLinecap="butt"
            strokeLinejoin="miter"
          >
            <path d="M25,55A20,20 0 1 0 25.001,55" />
            <path d="M45,50V100" />
          </g>
        </g>
        <g transform="translate(184.00 0)">
          <g
            fill="none"
            style={{ stroke: "var(--rn-color-text-primary)" }}
            strokeWidth="10"
            strokeLinecap="butt"
            strokeLinejoin="miter"
          >
            <path d="M10,33V100" />
            <path d="M0,55H27" />
          </g>
        </g>
        <g transform="translate(217.00 0)">
          <g
            fill="none"
            style={{ stroke: "var(--rn-color-text-primary)" }}
            strokeWidth="10"
            strokeLinecap="butt"
            strokeLinejoin="miter"
          >
            <path d="M5,50V100" />
          </g>
          <g style={{ fill: "var(--rn-color-text-primary)" }}>
            <circle cx="5" cy="36" r="6.5" />
          </g>
        </g>
        <g transform="translate(234.00 0)">
          <g
            fill="none"
            style={{ stroke: "var(--rn-color-text-primary)" }}
            strokeWidth="10"
            strokeLinecap="butt"
            strokeLinejoin="miter"
          >
            <path d="M25,55A20,20 0 1 0 25.001,55" />
          </g>
        </g>
        <g transform="translate(291.00 0)">
          <g
            fill="none"
            style={{ stroke: "var(--rn-color-text-primary)" }}
            strokeWidth="10"
            strokeLinecap="butt"
            strokeLinejoin="miter"
          >
            <path d="M5,50V100" />
            <path d="M5,75A20,20 0 0 1 45,75V100" />
          </g>
        </g>
        <g transform="translate(351.00 0)">
          <g style={{ fill: "var(--rn-color-logo-accent)" }}>
            <polygon points="0,100 0,30 12,30 45,83.7 45,30 55,30 55,100 43,100 10,46.3 10,100" />
          </g>
        </g>
        <g transform="translate(413.00 0)">
          <g
            fill="none"
            style={{ stroke: "var(--rn-color-logo-accent)" }}
            strokeWidth="10"
            strokeLinecap="butt"
            strokeLinejoin="miter"
          >
            <path d="M25,55A20,20 0 1 0 25.001,55" />
          </g>
        </g>
        <g transform="translate(469.00 0)">
          <g
            fill="none"
            style={{ stroke: "var(--rn-color-logo-accent)" }}
            strokeWidth="10"
            strokeLinecap="butt"
            strokeLinejoin="miter"
          >
            <path d="M10,33V100" />
            <path d="M0,55H27" />
          </g>
        </g>
        <g transform="translate(502.00 0)">
          <g
            fill="none"
            style={{ stroke: "var(--rn-color-logo-accent)" }}
            strokeWidth="10"
            strokeLinecap="butt"
            strokeLinejoin="miter"
          >
            <path d="M5,75H45A20,20 0 1 0 39.4,88.8" />
          </g>
        </g>
        <g transform="translate(559.00 0)">
          <g
            fill="none"
            style={{ stroke: "var(--rn-color-logo-accent)" }}
            strokeWidth="10"
            strokeLinecap="butt"
            strokeLinejoin="miter"
          >
            <path d="M37.5,61C34.5,56.5 29,55 21.5,55C12.5,55 6,58.5 6,65.5C6,72.5 12,74 20.5,75.5C29.5,77 36,79.5 36,85.5C36,92 29.5,95 20.5,95C12,95 5.5,92 2.5,87" />
          </g>
        </g>
      </g>
    </svg>
  );
}
