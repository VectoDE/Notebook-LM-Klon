// Schriften selbst gehostet (OFL, über Vite gebündelt, kein externes CDN)
import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/geist";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { ThemeProvider } from "./useTheme.js";
import "./themes.css";
import "./workspace.css";

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <ThemeProvider>
        <App mode="workspace" />
      </ThemeProvider>
    </StrictMode>
  );
}
