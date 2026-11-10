import type {
  SlideChartData,
  VideoChapter,
  VideoSlide,
  VideoStoryboard
} from "@notebook-lm/shared";
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

export interface VideoOverviewPlayerProps {
  readonly storyboard: VideoStoryboard;
  readonly onTimeUpdate?: (currentTimeMs: number) => void;
  readonly onEnded?: () => void;
  readonly autoplay?: boolean;
}

export function drawSlideToCanvas(
  ctx: CanvasRenderingContext2D,
  slide: VideoSlide,
  width: number,
  height: number,
  transitionProgress = 1.0, // 0 = start of transition, 1 = fully settled
  reducedMotion = false
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

export function VideoOverviewPlayer(props: VideoOverviewPlayerProps) {
  const { storyboard, onTimeUpdate, onEnded, autoplay = false } = props;

  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoplay);
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [audioDescriptionEnabled, setAudioDescriptionEnabled] = useState(false);
  const [isReducedMotion, setIsReducedMotion] = useState(false);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [currentSubtitle, setCurrentSubtitle] = useState<string>("");
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>("");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number | null>(null);

  // Check prefers-reduced-motion media query
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      setIsReducedMotion(mediaQuery.matches);
      const handler = (e: MediaQueryListEvent) => setIsReducedMotion(e.matches);
      mediaQuery.addEventListener?.("change", handler);
      return () => mediaQuery.removeEventListener?.("change", handler);
    }
  }, []);

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
        setLiveAnnouncement(`Audiodeskription: ${activeSlide.audioDescription}`);
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
    onTimeUpdate
  ]);

  // Canvas render loop
  const renderCanvas = useCallback(
    (progress = 1.0) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const slide = storyboard.slides[activeSlideIndex];
      if (slide) {
        drawSlideToCanvas(ctx, slide, canvas.width, canvas.height, progress, isReducedMotion);
      }
    },
    [storyboard.slides, activeSlideIndex, isReducedMotion]
  );

  // Re-draw when active slide or motion preference changes
  useEffect(() => {
    renderCanvas(1.0);
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

      // Calculate transition progress for current slide (settles in first 400ms)
      const currentSlide = storyboard.slides[activeSlideIndex];
      if (currentSlide) {
        const elapsedInSlide = currentTimeMs - currentSlide.startTimeMs;
        const progress = Math.min(1.0, elapsedInSlide / 400);
        renderCanvas(progress);
      }

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
  }, [
    isPlaying,
    activeSlideIndex,
    currentTimeMs,
    storyboard.durationMs,
    storyboard.slides,
    storyboard.audioUrl,
    renderCanvas,
    onEnded
  ]);

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
    setLiveAnnouncement(`Sprung zu Kapitel: ${chapter.title}`);
  };

  // Accessible keyboard shortcuts
  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    switch (e.key) {
      case " ":
      case "k":
        e.preventDefault();
        handlePlayPause();
        break;
      case "ArrowLeft":
        e.preventDefault();
        handleSeek(currentTimeMs - 5000);
        break;
      case "ArrowRight":
        e.preventDefault();
        handleSeek(currentTimeMs + 5000);
        break;
      case "c":
        e.preventDefault();
        setShowSubtitles((prev) => !prev);
        break;
      case "d":
        e.preventDefault();
        setAudioDescriptionEnabled((prev) => {
          const next = !prev;
          if (next) {
            const currentSlide = storyboard.slides[activeSlideIndex];
            if (currentSlide) {
              setLiveAnnouncement(`Audiodeskription aktiviert: ${currentSlide.audioDescription}`);
            }
          } else {
            setLiveAnnouncement("Audiodeskription deaktiviert.");
          }
          return next;
        });
        break;
    }
  };

  const currentSlide = storyboard.slides[activeSlideIndex];
  const activeChapter = storyboard.chapters.find(
    (ch) => currentTimeMs >= ch.startTimeMs && currentTimeMs <= ch.endTimeMs
  );

  return (
    <section
      className="video-overview-player flex flex-col gap-4 rounded-xl bg-slate-900 p-4 text-white shadow-2xl focus:outline-none focus:ring-2 focus:ring-blue-500"
      aria-label={`Video Overview Player: ${storyboard.title}`}
      onKeyDown={handleKeyDown}
      data-testid="video-overview-player"
    >
      {/* Visual Canvas Container */}
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black shadow-inner">
        <canvas
          ref={canvasRef}
          width={storyboard.resolution.width}
          height={storyboard.resolution.height}
          className="h-full w-full object-contain"
          data-testid="slide-canvas"
        />

        {/* Subtitles Overlay */}
        {showSubtitles && currentSubtitle && (
          <div
            className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded bg-black/85 px-4 py-1.5 text-center text-lg font-medium text-white shadow-md"
            data-testid="subtitles-overlay"
            aria-live="polite"
          >
            {currentSubtitle}
          </div>
        )}

        {/* Audio Element (if audioUrl provided) */}
        {storyboard.audioUrl && (
          <audio ref={audioRef} src={storyboard.audioUrl} data-testid="player-audio-element">
            <track kind="captions" srcLang="de" label="Deutsch" />
          </audio>
        )}
      </div>

      {/* Screen reader live region for accessibility & audio description */}
      <output className="sr-only" aria-live="polite" data-testid="a11y-live-region">
        {liveAnnouncement}
      </output>

      {/* Timeline Scrubber */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>
            {Math.floor(currentTimeMs / 1000)}s / {Math.floor(storyboard.durationMs / 1000)}s
          </span>
          {activeChapter && <span>Kapitel: {activeChapter.title}</span>}
        </div>
        <input
          type="range"
          min={0}
          max={storyboard.durationMs}
          value={currentTimeMs}
          onChange={(e) => handleSeek(Number(e.target.value))}
          className="w-full cursor-pointer accent-blue-500"
          aria-label="Video-Fortschrittsregler"
          data-testid="timeline-scrubber"
        />
      </div>

      {/* Player Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePlayPause}
            className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            data-testid="play-pause-button"
            aria-label={isPlaying ? "Video pausieren" : "Video abspielen"}
          >
            {isPlaying ? "Pausieren" : "Abspielen"}
          </button>

          <button
            type="button"
            onClick={() => setShowSubtitles((prev) => !prev)}
            className={`rounded px-3 py-2 text-sm font-medium transition-colors ${
              showSubtitles ? "bg-slate-700 text-white" : "bg-slate-800 text-slate-400"
            }`}
            data-testid="toggle-subtitles-button"
            aria-pressed={showSubtitles}
            aria-label="Untertitel an/aus (C)"
          >
            CC Untertitel
          </button>

          <button
            type="button"
            onClick={() =>
              setAudioDescriptionEnabled((prev) => {
                const next = !prev;
                if (next && currentSlide) {
                  setLiveAnnouncement(
                    `Audiodeskription aktiviert: ${currentSlide.audioDescription}`
                  );
                }
                return next;
              })
            }
            className={`rounded px-3 py-2 text-sm font-medium transition-colors ${
              audioDescriptionEnabled ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-400"
            }`}
            data-testid="toggle-ad-button"
            aria-pressed={audioDescriptionEnabled}
            aria-label="Audiodeskription fuer Sehbehinderte an/aus (D)"
          >
            AD Audiodeskription
          </button>
        </div>

        {/* Chapter Quick Jumps */}
        <nav className="flex items-center gap-1.5" aria-label="Kapitelauswahl">
          <span className="text-xs text-slate-400 mr-1">Kapitel:</span>
          {storyboard.chapters.map((ch) => {
            const isCurrent = activeChapter?.id === ch.id;
            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => jumpToChapter(ch)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  isCurrent
                    ? "bg-blue-500/30 text-blue-300 ring-1 ring-blue-500"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
                data-testid={`chapter-btn-${ch.id}`}
                aria-current={isCurrent ? "true" : undefined}
                aria-label={`Kapitel ${ch.index + 1}: ${ch.title}`}
              >
                {ch.title}
              </button>
            );
          })}
        </nav>
      </div>
    </section>
  );
}
