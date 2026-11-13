import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { scheduleStudioViewerPreload } from "./lazy-viewers.js";
import { ThemeProvider } from "./useTheme.js";
// Schriften selbst gehostet (OFL, Latin-Subset, von Vite gehasht, kein externes CDN)
import "./fonts.css";
import "./themes.css";
import "./workspace.css";
import "./components.css";

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <ThemeProvider>
        <App mode="workspace" />
      </ThemeProvider>
    </StrictMode>
  );
  // Studio-Viewer nach dem ersten Rendern im Leerlauf nachladen (#257, LCP mobil).
  scheduleStudioViewerPreload();
}
