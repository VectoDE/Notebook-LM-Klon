import { WORKSPACE_VERSION } from "@notebook-lm/shared";

export function App() {
  return (
    <main aria-labelledby="app-title">
      <h1 id="app-title">NotebookLM Klon</h1>
      <p>Version {WORKSPACE_VERSION} – Bereit für Forschung, Quellenanalyse und Studio-Synthese.</p>
    </main>
  );
}
