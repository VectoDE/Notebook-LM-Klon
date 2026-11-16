import { join } from "node:path";

/** Wurzel des Pakets `apps/worker`, unabhängig vom Ordner, in dem eine Testdatei liegt. */
export const WORKER_ROOT = join(import.meta.dirname, "../..");

/** Wurzel des Repositories. */
export const REPO_ROOT = join(WORKER_ROOT, "../..");

/** D1-Migrationen (bleiben bewusst unter `apps/worker/migrations`). */
export const MIGRATIONS_DIR = join(WORKER_ROOT, "migrations");
