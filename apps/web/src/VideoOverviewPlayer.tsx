import type {
  SlideChartData,
  VideoChapter,
  VideoSlide,
  VideoStoryboard
} from "@notebook-lm/shared";
import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icon.js";
import { useTheme } from "./useTheme.js";

export interface VideoOverviewPlayerProps {
  readonly storyboard: VideoStoryboard;
  readonly onTimeUpdate?: (currentTimeMs: number) => void;
  readonly onEnded?: () => void;
  readonly autoplay?: boolean;
}

/**
 * "full" zeichnet die komplette Folie samt Text (WebM-Export).
 * "backdrop" zeichnet nur den Hintergrund; der Folientext steht im Player als HTML darüber,
 * damit er auf jeder Breite lesbar groß ist und Screenreader ihn erreichen.
 */
export type SlideCanvasLayer = "full" | "backdrop";

/** Elemente, deren Tasten (Leertaste, Pfeile) nicht als Player-Kürzel gelten. */
const SHORTCUT_EXEMPT_SELECTOR =
  "button, input, select, textarea, a[href], [contenteditable='true'], [role='slider']";

/** Ziel-Luminanz des Hintergrunds, damit heller Bühnentext mindestens 7:1 erreicht. */
const MAX_BACKDROP_LUMINANCE = 0.08;

/** Zeit als m:ss bzw. h:mm:ss, z. B. 65 000 ms → "1:05". */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

/** true, wenn ein Tastendruck von einem eigenen Bedienelement kommt und dort bleiben soll. */
export function isShortcutExemptTarget(target: EventTarget | null): boolean {
  const closest = (target as { closest?: unknown } | null)?.closest;
  if (typeof closest !== "function") return false;
  return Boolean((target as Element).closest(SHORTCUT_EXEMPT_SELECTOR));
}

function relativeLuminance(hex: string): number | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return null;
  const digits =
    match[1].length === 3
      ? match[1]
          .split("")
          .map((d) => d + d)
          .join("")
      : match[1];
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = Number.parseInt(digits.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Deckkraft der dunklen Abdeckung über dem Folienverlauf. Dunkle Verläufe bleiben unverändert,
 * helle werden so weit abgedunkelt, dass heller Text 7:1 hält. Unbekannte Farbformate: 0,6.
 */
export function backdropScrimAlpha(colors: readonly string[]): number {
  let alpha = 0;
  for (const color of colors) {
    const lum = relativeLuminance(color);
    if (lum === null) return 0.6;
    // Abdunkeln mit Schwarz skaliert die lineare Luminanz etwa mit (1 - a)^2.2
    let a = 0;
    while (a < 0.9 && lum * (1 - a) ** 2.2 > MAX_BACKDROP_LUMINANCE) a += 0.05;
    alpha = Math.max(alpha, Math.round(a * 100) / 100);
  }
  return alpha;
}

export function drawSlideToCanvas(
  ctx: CanvasRenderingContext2D,
  slide: VideoSlide,
  width: number,
  height: number,
  transitionProgress = 1.0, // 0 = start of transition, 1 = fully settled
  reducedMotion = false,
  layer: SlideCanvasLayer = "full"
): void {
  // Clear canvas
  ctx.save();
  ctx.clearRect(0, 0, width, height);

  // Background Gradient
  const [color1, color2] = slide.visualTheme.backgroundGradient;
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, color1);
  grad.addColorStop(1, color2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  if (layer === "backdrop") {
    const scrim = backdropScrimAlpha(slide.visualTheme.backgroundGradient);
    if (scrim > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${scrim})`;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.restore();
    return;
  }

  // Motion easing / offset calculation
  const motionOffset = reducedMotion ? 0 : Math.round((1.0 - transitionProgress) * 40);
  const alpha = reducedMotion ? 1.0 : Math.max(0, Math.min(1, transitionProgress));
  ctx.globalAlpha = alpha;

  const padX = Math.round(width * 0.08);
  let currentY = Math.round(height * 0.14) + motionOffset;

  // Subtitle / Chapter Tag
  if (slide.subtitle) {
    ctx.fillStyle = slide.visualTheme.accentColor;
    ctx.font = `600 ${Math.round(height * 0.03)}px sans-serif`;
    ctx.fillText(slide.subtitle.toUpperCase(), padX, currentY);
    currentY += Math.round(height * 0.05);
  }

  // Slide Title
  ctx.fillStyle = slide.visualTheme.textColor;
  ctx.font = `bold ${Math.round(height * 0.055)}px sans-serif`;
  ctx.fillText(slide.title, padX, currentY);
  currentY += Math.round(height * 0.04);

  // Accent Line
  ctx.fillStyle = slide.visualTheme.accentColor;
  ctx.fillRect(padX, currentY, Math.round(width * 0.15), 4);
  currentY += Math.round(height * 0.06);

  // Bullet Points or Chart Layout
  const contentWidth = slide.chart ? Math.round(width * 0.42) : Math.round(width * 0.84);
  ctx.fillStyle = slide.visualTheme.textColor;
  ctx.font = `400 ${Math.round(height * 0.032)}px sans-serif`;

  for (let i = 0; i < slide.bulletPoints.length; i++) {
    const point = slide.bulletPoints[i];
    if (!point) continue;

    // Bullet dot
    ctx.fillStyle = slide.visualTheme.accentColor;
    ctx.beginPath();
    ctx.arc(padX + 10, currentY - 8, 6, 0, Math.PI * 2);
    ctx.fill();

    // Bullet text
    ctx.fillStyle = slide.visualTheme.textColor;
    ctx.fillText(point, padX + 30, currentY, contentWidth);
    currentY += Math.round(height * 0.055);
  }

  // Chart rendering (if present)
  if (slide.chart) {
    drawChart(
      ctx,
      slide.chart,
      Math.round(width * 0.55),
      Math.round(height * 0.28),
      Math.round(width * 0.35),
      Math.round(height * 0.38),
      slide.visualTheme.accentColor
    );
  }

  // Citations / Reference footer
  if (slide.citations && slide.citations.length > 0) {
    const citation = slide.citations[0];
    if (citation) {
      const footerY = Math.round(height * 0.88);
      ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
      ctx.fillRect(padX, footerY - 25, width - padX * 2, 45);

      ctx.fillStyle = "#94a3b8";
      ctx.font = `italic 400 ${Math.round(height * 0.022)}px sans-serif`;
      const citationText = `Quelle: "${citation.sourceTitle}" – "${citation.quote}"`;
      ctx.fillText(citationText, padX + 16, footerY + 2, width - padX * 2 - 32);
    }
  }

  ctx.restore();
}

function drawChart(
  ctx: CanvasRenderingContext2D,
  chart: SlideChartData,
  x: number,
  y: number,
  w: number,
  h: number,
  accentColor: string
): void {
  ctx.save();
  // Chart background card
  ctx.fillStyle = "rgba(15, 23, 42, 0.6)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.strokeRect(x, y, w, h);

  // Chart title
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 18px sans-serif";
  ctx.fillText(chart.title, x + 20, y + 32);

  // Chart Bars
  const data = chart.data;
  if (data.length > 0) {
    const maxVal = Math.max(...data.map((d) => d.value), 1);
    const barAreaY = y + 60;
    const barAreaH = h - 100;
    const barWidth = Math.min(60, Math.floor((w - 40) / data.length - 15));

    data.forEach((d, i) => {
      const barX = x + 30 + i * (barWidth + 20);
      const barHeight = Math.round((d.value / maxVal) * barAreaH);
      const barY = barAreaY + (barAreaH - barHeight);

      // Bar
      ctx.fillStyle = d.color ?? accentColor;
      ctx.fillRect(barX, barY, barWidth, barHeight);

      // Value label
      ctx.fillStyle = "#ffffff";
      ctx.font = "12px sans-serif";
      const valStr = `${d.value}${chart.unit ?? ""}`;
      ctx.fillText(valStr, barX, barY - 6);

      // Category label
      ctx.fillStyle = "#94a3b8";
      ctx.font = "12px sans-serif";
      ctx.fillText(d.label, barX, barAreaY + barAreaH + 20, barWidth + 10);
    });
  }

  ctx.restore();
}

/** Folientext als HTML: Kicker, Titel, Punkte, Diagramm als Balkenliste, Quelle. */
function SlideText({ slide, bodyId }: { readonly slide: VideoSlide; readonly bodyId: string }) {
  const { tf } = useTheme();
  const chart = slide.chart;
  const maxValue = chart ? Math.max(...chart.data.map((d) => d.value), 1) : 1;
  const citation = slide.citations?.[0];
  return (
    <div className="rn-video-slide" data-testid="video-slide-text">
      {slide.subtitle && <p className="rn-video-kicker">{slide.subtitle}</p>}
      <h3 className="rn-video-title">{slide.title}</h3>
      <div className="rn-video-body" id={bodyId}>
        {slide.bulletPoints.length > 0 && (
          <ul className="rn-video-points">
            {slide.bulletPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        )}
        {chart && chart.data.length > 0 && (
          <figure className="rn-video-chart">
            <figcaption className="rn-video-chart-title">{chart.title}</figcaption>
            <ul className="rn-video-bars">
              {chart.data.map((d) => (
                <li key={d.label} className="rn-video-bar">
                  <span className="rn-video-bar-label">{d.label}</span>
                  <svg
                    className="rn-video-bar-track"
                    viewBox="0 0 100 10"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <rect
                      width={Math.max(2, Math.round((Math.max(0, d.value) / maxValue) * 100))}
                      height="10"
                      rx="2"
                      fill="currentColor"
                    />
                  </svg>
                  <span className="rn-video-bar-value">
                    {d.value}
                    {chart.unit ?? ""}
                  </span>
                </li>
              ))}
            </ul>
          </figure>
        )}
        {citation && (
          <p className="rn-video-source">
            {tf("videoSource", { title: citation.sourceTitle, quote: citation.quote })}
          </p>
        )}
      </div>
    </div>
  );
}

export function VideoOverviewPlayer(props: VideoOverviewPlayerProps) {
  const { storyboard, onTimeUpdate, onEnded, autoplay = false } = props;
  const { t, tf } = useTheme();

  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoplay);
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [audioDescriptionEnabled, setAudioDescriptionEnabled] = useState(false);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [currentSubtitle, setCurrentSubtitle] = useState<string>("");
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>("");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number | null>(null);

  const idBase = useId();
  const slideBodyId = `${idBase}-slide`;
  const hintId = `${idBase}-hint`;

  // Determine current slide and subtitle from currentTimeMs
  useEffect(() => {
    let foundSlideIndex = 0;
    for (let i = 0; i < storyboard.slides.length; i++) {
      const slide = storyboard.slides[i];
      if (slide && currentTimeMs >= slide.startTimeMs && currentTimeMs < slide.endTimeMs) {
        foundSlideIndex = i;
        break;
      }
      if (slide && i === storyboard.slides.length - 1 && currentTimeMs >= slide.endTimeMs) {
        foundSlideIndex = i;
      }
    }

    if (foundSlideIndex !== activeSlideIndex) {
      setActiveSlideIndex(foundSlideIndex);
      const activeSlide = storyboard.slides[foundSlideIndex];
      if (activeSlide && audioDescriptionEnabled) {
        setLiveAnnouncement(tf("videoLiveAd", { text: activeSlide.audioDescription }));
      }
    }

    // Subtitle cue matching
    if (showSubtitles) {
      const activeCue = storyboard.subtitles.find(
        (cue) => currentTimeMs >= cue.startTimeMs && currentTimeMs < cue.endTimeMs
      );
      setCurrentSubtitle(activeCue ? activeCue.text : "");
    } else {
      setCurrentSubtitle("");
    }

    onTimeUpdate?.(currentTimeMs);
  }, [
    currentTimeMs,
    storyboard.slides,
    storyboard.subtitles,
    activeSlideIndex,
    audioDescriptionEnabled,
    showSubtitles,
    onTimeUpdate,
    tf
  ]);

  // Hintergrund der aktiven Folie zeichnen; der Text steht als HTML darüber
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const slide = storyboard.slides[activeSlideIndex];
    if (slide) {
      drawSlideToCanvas(ctx, slide, canvas.width, canvas.height, 1, true, "backdrop");
    }
  }, [storyboard.slides, activeSlideIndex]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // Playback timer & requestAnimationFrame loop
  useEffect(() => {
    if (!isPlaying) {
      if (animFrameIdRef.current !== null && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
      lastTimestampRef.current = null;
      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
      }
      return;
    }

    if (audioRef.current?.paused && storyboard.audioUrl) {
      audioRef.current.play().catch(() => {
        // Autoplay may be blocked by user-agent policy
      });
    }

    const onFrame = (now: number) => {
      if (lastTimestampRef.current === null) {
        lastTimestampRef.current = now;
      }
      const delta = now - lastTimestampRef.current;
      lastTimestampRef.current = now;

      setCurrentTimeMs((prev) => {
        const next = prev + delta;
        if (next >= storyboard.durationMs) {
          setIsPlaying(false);
          onEnded?.();
          return storyboard.durationMs;
        }
        return next;
      });

      if (typeof requestAnimationFrame !== "undefined") {
        animFrameIdRef.current = requestAnimationFrame(onFrame);
      }
    };

    if (typeof requestAnimationFrame !== "undefined") {
      animFrameIdRef.current = requestAnimationFrame(onFrame);
    }

    return () => {
      if (animFrameIdRef.current !== null && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, [isPlaying, storyboard.durationMs, storyboard.audioUrl, onEnded]);

  const currentSlide = storyboard.slides[activeSlideIndex];

  // Navigation handlers
  const handlePlayPause = () => {
    setIsPlaying((prev) => !prev);
  };

  const handleSeek = (targetMs: number) => {
    const clamped = Math.max(0, Math.min(storyboard.durationMs, targetMs));
    setCurrentTimeMs(clamped);
    if (audioRef.current) {
      audioRef.current.currentTime = clamped / 1000;
    }
  };

  const jumpToChapter = (chapter: VideoChapter) => {
    handleSeek(chapter.startTimeMs);
    setLiveAnnouncement(tf("videoLiveJump", { title: chapter.title }));
  };

  const toggleSubtitles = () => {
    const next = !showSubtitles;
    setShowSubtitles(next);
    setLiveAnnouncement(t(next ? "videoSubsOn" : "videoSubsOff"));
  };

  const toggleAudioDescription = () => {
    const next = !audioDescriptionEnabled;
    setAudioDescriptionEnabled(next);
    setLiveAnnouncement(
      next
        ? tf("videoAdOn", { text: currentSlide?.audioDescription ?? "" }).trim()
        : t("videoAdOff")
    );
  };

  // Tastenkürzel am Player; Knöpfe, Regler und Eingaben behalten ihre eigenen Tasten
  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || isShortcutExemptTarget(e.target)) return;
    switch (e.key.toLowerCase()) {
      case " ":
      case "k":
        e.preventDefault();
        handlePlayPause();
        break;
      case "arrowleft":
        e.preventDefault();
        handleSeek(currentTimeMs - 5000);
        break;
      case "arrowright":
        e.preventDefault();
        handleSeek(currentTimeMs + 5000);
        break;
      case "c":
        e.preventDefault();
        toggleSubtitles();
        break;
      case "d":
        e.preventDefault();
        toggleAudioDescription();
        break;
    }
  };

  const activeChapter = storyboard.chapters.find(
    (ch) => currentTimeMs >= ch.startTimeMs && currentTimeMs <= ch.endTimeMs
  );
  const durationSec = Math.max(1, Math.ceil(storyboard.durationMs / 1000));
  const currentSec = Math.min(durationSec, Math.floor(currentTimeMs / 1000));
  const timeText = tf("videoTime", {
    current: formatTime(currentTimeMs),
    total: formatTime(storyboard.durationMs)
  });

  return (
    <section
      className="rn-video"
      aria-label={tf("videoAria", { title: storyboard.title })}
      aria-describedby={hintId}
      aria-keyshortcuts="Space K ArrowLeft ArrowRight C D"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Der Player ist das Ziel seiner Tastenkürzel (aria-keyshortcuts).
      tabIndex={0}
      onKeyDown={handleKeyDown}
      data-testid="video-overview-player"
    >
      <p id={hintId} className="sr-only">
        {t("videoHint")}
      </p>

      <div className="rn-video-screen">
        <canvas
          ref={canvasRef}
          width={storyboard.resolution.width}
          height={storyboard.resolution.height}
          className="rn-video-canvas"
          role="img"
          aria-label={
            currentSlide
              ? tf("videoSlideAria", {
                  n: activeSlideIndex + 1,
                  total: storyboard.slides.length,
                  title: currentSlide.title
                })
              : t("videoSlide")
          }
          aria-describedby={currentSlide ? slideBodyId : undefined}
          data-testid="slide-canvas"
        />

        {currentSlide && (
          <SlideText key={currentSlide.id} slide={currentSlide} bodyId={slideBodyId} />
        )}

        {showSubtitles && currentSubtitle && (
          <div className="rn-video-subtitle" data-testid="subtitles-overlay" aria-live="polite">
            {currentSubtitle}
          </div>
        )}

        {storyboard.audioUrl && (
          <audio ref={audioRef} src={storyboard.audioUrl} data-testid="player-audio-element">
            <track kind="captions" srcLang="de" label="Deutsch" />
          </audio>
        )}
      </div>

      <output className="sr-only" aria-live="polite" data-testid="a11y-live-region">
        {liveAnnouncement}
      </output>

      <div className="rn-video-timeline">
        <div className="rn-video-time">
          <span data-testid="video-time">
            {formatTime(currentTimeMs)} / {formatTime(storyboard.durationMs)}
          </span>
          {activeChapter && <span>{tf("videoChapter", { title: activeChapter.title })}</span>}
        </div>
        <input
          type="range"
          min={0}
          max={durationSec}
          step={1}
          value={currentSec}
          onChange={(e) => handleSeek(Number(e.target.value) * 1000)}
          className="rn-range"
          aria-label={t("videoScrub")}
          aria-valuetext={timeText}
          data-testid="timeline-scrubber"
        />
      </div>

      <div className="rn-video-controls">
        <div className="rn-video-buttons">
          <button
            type="button"
            onClick={handlePlayPause}
            className="rn-stage-btn rn-stage-btn--primary"
            data-testid="play-pause-button"
            aria-keyshortcuts="K"
          >
            {t(isPlaying ? "mediaPause" : "mediaPlay")}
          </button>

          <button
            type="button"
            onClick={toggleSubtitles}
            className="rn-stage-btn rn-video-toggle"
            data-testid="toggle-subtitles-button"
            aria-pressed={showSubtitles}
            aria-keyshortcuts="C"
          >
            <span className="rn-video-toggle-box" aria-hidden="true">
              <Icon name="check" size={16} className="rn-icon rn-video-toggle-check" />
            </span>
            {t("videoSubtitles")}
          </button>

          <button
            type="button"
            onClick={toggleAudioDescription}
            className="rn-stage-btn rn-video-toggle"
            data-testid="toggle-ad-button"
            aria-pressed={audioDescriptionEnabled}
            aria-keyshortcuts="D"
          >
            <span className="rn-video-toggle-box" aria-hidden="true">
              <Icon name="check" size={16} className="rn-icon rn-video-toggle-check" />
            </span>
            {t("videoAudioDesc")}
          </button>
        </div>

        <nav className="rn-video-chapters" aria-label={t("videoChaptersNav")}>
          <span className="rn-video-chapters-label">{t("videoChaptersLabel")}</span>
          {storyboard.chapters.map((ch) => {
            const isCurrent = activeChapter?.id === ch.id;
            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => jumpToChapter(ch)}
                className="rn-stage-chip"
                data-testid={`chapter-btn-${ch.id}`}
                aria-current={isCurrent ? "true" : undefined}
              >
                {ch.title}
                <span className="sr-only">
                  {tf("videoChapterSr", { n: ch.index + 1, total: storyboard.chapters.length })}
                </span>
              </button>
            );
          })}
        </nav>
      </div>
    </section>
  );
}
