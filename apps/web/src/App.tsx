import { WORKSPACE_VERSION } from "@notebook-lm/shared";

export function App() {
  return (
    <main aria-labelledby="app-title">
      <h1 id="app-title">RelationNotes – NotebookLM &amp; RelationFlow Knowledge Studio</h1>
      <p>
        Version {WORKSPACE_VERSION} – Bereit für Forschung, Quellenanalyse, Wissengraphen und
        Studio-Synthese.
      </p>
    </main>
  );
}
