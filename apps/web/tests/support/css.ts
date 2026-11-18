import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WEB_ROOT } from "./paths";

/**
 * Liest die Workspace-Stile als einen Text: alle Teile aus `styles/workspace/` in der
 * Reihenfolge der `@import`-Zeilen von `index.css` (so wie die Kaskade sie sieht).
 */
export function readWorkspaceCss(): string {
  const dir = join(WEB_ROOT, "src/styles/workspace");
  const index = readFileSync(join(dir, "index.css"), "utf8");
  const parts = [...index.matchAll(/@import "\.\/([^"]+)";/g)].map((m) => m[1] as string);
  if (parts.length < 30) throw new Error(`index.css bindet nur ${parts.length} Teile ein`);
  return parts.map((p) => readFileSync(join(dir, p), "utf8")).join("");
}
