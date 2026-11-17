import { WORKSPACE_VERSION } from "@notebook-lm/shared";

// Eigenes Modul, damit die Worker-Entry-Datei keine Nicht-Handler-Exporte hat
// (workerd wertet jeden Export der Entry-Datei als Binding und bricht sonst ab).
export const WORKER_VERSION = WORKSPACE_VERSION;
