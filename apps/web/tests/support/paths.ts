import { join } from "node:path";

/** Wurzel des Pakets `apps/web`, unabhängig vom Ordner, in dem eine Testdatei liegt. */
export const WEB_ROOT = join(import.meta.dirname, "../..");

/** Wurzel des Repositories. */
export const REPO_ROOT = join(WEB_ROOT, "../..");
