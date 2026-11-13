/**
 * Version des Workspaces (entspricht package.json). Eigenes Modul, damit die Web-Oberfläche
 * sie ohne die Zod-Schemas aus index.ts importieren kann (Tree-Shaking, Issue #257).
 */
export const WORKSPACE_VERSION = "0.1.0" as const;
