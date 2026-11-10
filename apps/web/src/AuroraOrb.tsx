/**
 * 60fps Aurora Orb Canvas Component.
 *
 * Implements Sub-Issue #130:
 * - 60fps Aurora Orb on Canvas with flowing gradients and interactive audio response.
 * - Accessibility: 'prefers-reduced-motion: reduce' switches to a calm, static gradient immediately.
 */

import { useEffect, useRef } from "react";

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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

        if (activeSpeaker === "hostB") {
          gradient.addColorStop(0, "rgba(59, 130, 246, 0.85)");
          gradient.addColorStop(0.5, "rgba(96, 165, 250, 0.5)");
          gradient.addColorStop(1, "rgba(30, 58, 138, 0)");
        } else if (activeSpeaker === "hostA") {
          gradient.addColorStop(0, "rgba(168, 85, 247, 0.85)");
          gradient.addColorStop(0.5, "rgba(192, 132, 252, 0.5)");
          gradient.addColorStop(1, "rgba(88, 28, 135, 0)");
        } else {
          gradient.addColorStop(0, "rgba(99, 102, 241, 0.8)");
          gradient.addColorStop(0.6, "rgba(139, 92, 246, 0.4)");
          gradient.addColorStop(1, "rgba(30, 27, 75, 0)");
        }

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

      if (activeSpeaker === "hostA") {
        primaryGrad.addColorStop(0, "rgba(217, 70, 239, 0.9)");
        primaryGrad.addColorStop(0.4, "rgba(168, 85, 247, 0.6)");
        primaryGrad.addColorStop(1, "rgba(79, 70, 229, 0)");
      } else if (activeSpeaker === "hostB") {
        primaryGrad.addColorStop(0, "rgba(56, 189, 248, 0.9)");
        primaryGrad.addColorStop(0.4, "rgba(59, 130, 246, 0.6)");
        primaryGrad.addColorStop(1, "rgba(99, 102, 241, 0)");
      } else {
        primaryGrad.addColorStop(0, "rgba(129, 140, 248, 0.9)");
        primaryGrad.addColorStop(0.5, "rgba(192, 132, 252, 0.55)");
        primaryGrad.addColorStop(1, "rgba(67, 56, 202, 0)");
      }

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
      secGrad.addColorStop(0, "rgba(255, 255, 255, 0.4)");
      secGrad.addColorStop(0.5, "rgba(224, 231, 255, 0.2)");
      secGrad.addColorStop(1, "rgba(255, 255, 255, 0)");

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
  }, [isPlaying, audioLevel, activeSpeaker, width, height, reducedMotion]);

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
