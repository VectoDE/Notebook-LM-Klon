/**
 * Prüfseite nur für E2E (Issue #350): Video-Player mit hinterlegtem Gebärdensprachvideo.
 * Die Demo hat noch kein DGS-Video; hier steht ein selbst erzeugter Platzhalter
 * (einfarbig, 30 s, ffmpeg) an seiner Stelle, damit Bild im Bild und Gleichlauf prüfbar sind.
 * Wird nur vom Vite-Entwicklungsserver ausgeliefert, nicht gebaut.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { VideoOverviewPlayer } from "../../src/VideoOverviewPlayer.js";
import { DEFAULT_VIDEO_STORYBOARD } from "../../src/WorkspaceLayout.js";
import { ThemeProvider } from "../../src/useTheme.js";
import "../../src/fonts.css";
import "../../src/themes.css";
import "../../src/workspace.css";
import "../../src/components.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider>
        <VideoOverviewPlayer
          storyboard={{
            ...DEFAULT_VIDEO_STORYBOARD,
            signLanguageVideo: { url: "./dgs-platzhalter.webm", language: "gsg" }
          }}
        />
      </ThemeProvider>
    </StrictMode>
  );
}
