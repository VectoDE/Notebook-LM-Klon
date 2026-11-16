import { join } from "node:path";

/** Wurzel des Pakets `packages/shared`, unabhängig vom Ordner, in dem eine Testdatei liegt. */
export const SHARED_ROOT = join(import.meta.dirname, "../..");

/** Wurzel des Repositories. */
export const REPO_ROOT = join(SHARED_ROOT, "../..");
