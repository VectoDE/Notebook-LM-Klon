/**
 * 60fps Aurora Orb Canvas Component.
 *
 * Implements Sub-Issue #130:
 * - 60fps Aurora Orb on Canvas with flowing gradients and interactive audio response.
 * - Accessibility: 'prefers-reduced-motion: reduce' switches to a calm, static gradient immediately.
 * - Farben kommen aus dem aktiven Design (--rn-color-stage-accent, --rn-color-stage-text),
 *   nicht fest aus Indigo; bei Design- oder Moduswechsel wird neu gezeichnet.
 */

import { useEffect, useRef, useState } from "react";
import { orbPalette } from "./stage-visuals.js";

/** Zeichnet neu, wenn Design oder Farbmodus am Wurzelelement wechseln. */
function useDesignVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setVersion((v) => v + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-design", "data-color-mode"]
    });
    return () => observer.disconnect();
  }, []);
  return version;
}

export interface AuroraOrbProps {
  readonly isPlaying?: boolean | undefined;
  readonly audioLevel?: number | undefined; // 0.0 to 1.0
  readonly activeSpeaker?: "hostA" | "hostB" | null | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly reducedMotion?: boolean | undefined;
}

export function AuroraOrb({
  isPlaying = false,
  audioLevel = 0.3,
  activeSpeaker = null,
  width = 240,
  height = 240,
  reducedMotion = false
}: AuroraOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const designVersion = useDesignVersion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Bühnenfarben des aktiven Designs; der Effekt läuft bei jedem Designwechsel neu.
    void designVersion;
    const tokens = getComputedStyle(canvas);
    const palette = orbPalette(
      tokens.getPropertyValue("--rn-color-stage-accent"),
      tokens.getPropertyValue("--rn-color-stage-text"),
      activeSpeaker
    );

    // Check system preference for reduced motion if not passed explicitly
    const systemReducedMotion =
      reducedMotion ||
      (typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

    let animationFrameId: number | null = null;
    let time = 0;

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;
      const baseRadius = Math.min(width, height) * 0.38;

      if (systemReducedMotion || !isPlaying) {
        // Calm static gradient fallback for reduced-motion or idle state
        const gradient = ctx.createRadialGradient(
          centerX,
          centerY,
          baseRadius * 0.2,
          centerX,
          centerY,
          baseRadius * 1.1
        );

        gradient.addColorStop(0, palette.core);
        gradient.addColorStop(0.55, palette.mid);
        gradient.addColorStop(1, palette.edge);

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
        ctx.fill();
        return;
      }

      // 60fps Organic Flowing Gradient Simulation
      time += 0.04;
      const pulse = 1.0 + Math.sin(time * 2) * 0.06 + audioLevel * 0.15;
      const currentRadius = baseRadius * pulse;

      // Calculate organic orbital centers
      const orb1X = centerX + Math.cos(time) * (width * 0.08);
      const orb1Y = centerY + Math.sin(time * 1.3) * (height * 0.08);

      const orb2X = centerX + Math.sin(time * 0.8) * (width * 0.1);
      const orb2Y = centerY + Math.cos(time * 1.1) * (height * 0.1);

      // Primary gradient
      const primaryGrad = ctx.createRadialGradient(
        orb1X,
        orb1Y,
        currentRadius * 0.1,
        centerX,
        centerY,
        currentRadius * 1.2
      );

      primaryGrad.addColorStop(0, palette.core);
      primaryGrad.addColorStop(0.45, palette.mid);
      primaryGrad.addColorStop(1, palette.edge);

      ctx.fillStyle = primaryGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2);
      ctx.fill();

      // Secondary specular glow overlay
      const secGrad = ctx.createRadialGradient(
        orb2X,
        orb2Y,
        currentRadius * 0.05,
        orb2X,
        orb2Y,
        currentRadius * 0.8
      );
      secGrad.addColorStop(0, palette.glow);
      secGrad.addColorStop(0.5, palette.glowMid);
      secGrad.addColorStop(1, palette.glowEdge);

      ctx.fillStyle = secGrad;
      ctx.beginPath();
      ctx.arc(orb2X, orb2Y, currentRadius * 0.75, 0, Math.PI * 2);
      ctx.fill();

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isPlaying, audioLevel, activeSpeaker, width, height, reducedMotion, designVersion]);

  return (
    <div
      role="img"
      aria-label="Aurora Audio Orb Visualisierung"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width,
        height
      }}
      data-testid="aurora-orb-container"
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        data-testid="aurora-orb-canvas"
        style={{ width: `${width}px`, height: `${height}px` }}
      />
    </div>
  );
}
