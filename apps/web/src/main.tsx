import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@/hooks/useTheme.js";
import { afterSettled } from "@/lib/utils/after-settled.js";
import { sendUsageBeacon } from "@/services/analytics/usage-beacon.js";
import { App } from "./App.js";
import { scheduleStudioViewerPreload } from "./lazy-viewers.js";
// Schriften selbst gehostet (OFL, Latin-Subset, von Vite gehasht, kein externes CDN)
import "@/styles/fonts.css";
import "@/styles/themes.css";
import "@/styles/workspace.css";
import "@/styles/components.css";

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <ThemeProvider>
        <App mode="workspace" />
      </ThemeProvider>
    </StrictMode>
  );
  // Studio-Viewer erst nach dem Laden und im Leerlauf nachladen, nicht im Weg des LCP (#257).
  afterSettled(() => {
    // Code-Schrift freigeben (siehe workspace.css) und Studio-Viewer vorladen
    document.documentElement.classList.add("rn-mono-ready");
    scheduleStudioViewerPreload();
  });
}

// Cookieloser, aggregierter Seitenaufruf-Zähler ohne Kennung (Issue #262)
void sendUsageBeacon({
  fetch: window.fetch.bind(window),
  navigator: navigator as Navigator & { globalPrivacyControl?: boolean },
  production: import.meta.env.PROD
});
