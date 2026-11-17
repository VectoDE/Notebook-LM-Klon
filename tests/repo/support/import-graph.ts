import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative, sep } from "node:path";
import ts from "typescript";

/**
 * Zyklen- und Grenzprüfung für die Import-Struktur (Umbau F426, Plan Abschnitt 4.3).
 * Die TypeScript-Compiler-API liefert die Importe; es gibt keine zusätzliche Abhängigkeit.
 */
export interface PackageConfig {
  /** Anzeigename in den Meldungen. */
  name: string;
  /** Absoluter Pfad des Quellordners. */
  src: string;
  /** Gibt es den Alias `@/` auf den Quellordner? Für `shared` nein. */
  alias: boolean;
  /** Ordner (relativ zu `src`), für die keine Barrel-Regeln gelten. */
  skipFolders?: readonly string[];
  /** Einstiegsdateien (relativ zu src); nur von dort statisch erreichbare Module gelten als Start-Code. */
  entries?: readonly string[];
  /** Erlaubte Ordnerkanten `von->nach` (statische Wert-Importe). `undefined`: nicht prüfen. */
  allowedEdges?: readonly string[];
}

export type Kind =
  | "cycle"
  | "barrel-logic"
  | "own-barrel"
  | "deep-import"
  | "dynamic-reexport"
  | "alias-in-shared"
  | "edge-not-allowed";

export interface Violation {
  kind: Kind;
  message: string;
}

interface Edge {
  from: string;
  to: string;
  typeOnly: boolean;
  dynamic: boolean;
  reexport: boolean;
  names: readonly string[];
}

const SRC_EXT = /\.(ts|tsx)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(full, out);
    } else if (SRC_EXT.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

const posix = (p: string): string => p.split(sep).join("/");

function resolveSpec(
  cfg: PackageConfig,
  from: string,
  spec: string,
  files: ReadonlySet<string>
): string | undefined {
  let base: string;
  if (spec.startsWith("@/")) {
    if (!cfg.alias) return undefined;
    base = join(cfg.src, spec.slice(2));
  } else if (spec.startsWith(".")) base = join(dirname(from), spec);
  else return undefined;
  base = normalize(base);
  const stripped = base.replace(/\.(js|jsx|mjs)$/, "");
  const candidates = [
    `${stripped}.ts`,
    `${stripped}.tsx`,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx")
  ];
  return candidates.find((c) => files.has(c));
}

export interface Analysis {
  files: string[];
  edges: Edge[];
  dynamicTargets: Set<string>;
  parsed: Map<string, ts.SourceFile>;
}

export function analyze(cfg: PackageConfig): Analysis {
  const files = walk(cfg.src);
  const fileSet = new Set(files.map(normalize));
  const parsed = new Map<string, ts.SourceFile>();
  const edges: Edge[] = [];
  const dynamicTargets = new Set<string>();
  for (const file of files) {
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    parsed.set(file, sf);
    const add = (spec: string, e: Omit<Edge, "from" | "to">): void => {
      const to = resolveSpec(cfg, file, spec, fileSet);
      if (to) edges.push({ ...e, from: file, to });
      else if (spec.startsWith("@/") && !cfg.alias)
        edges.push({ ...e, from: file, to: `@alias:${spec}` });
    };
    const visit = (n: ts.Node): void => {
      if (
        ts.isCallExpression(n) &&
        n.expression.kind === ts.SyntaxKind.ImportKeyword &&
        n.arguments[0] &&
        ts.isStringLiteralLike(n.arguments[0])
      ) {
        const to = resolveSpec(cfg, file, n.arguments[0].text, fileSet);
        if (to) {
          dynamicTargets.add(to);
          edges.push({
            from: file,
            to,
            typeOnly: false,
            dynamic: true,
            reexport: false,
            names: []
          });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.importClause) {
        const c = st.importClause;
        const names: string[] = [];
        let allTypes = c.isTypeOnly;
        if (c.namedBindings && ts.isNamedImports(c.namedBindings)) {
          const valueNames = c.namedBindings.elements.filter((e) => !e.isTypeOnly);
          for (const e of valueNames) names.push((e.propertyName ?? e.name).text);
          if (!c.name && valueNames.length === 0) allTypes = true;
        }
        add(st.moduleSpecifier.text, {
          typeOnly: allTypes,
          dynamic: false,
          reexport: false,
          names
        });
      } else if (
        ts.isExportDeclaration(st) &&
        st.moduleSpecifier &&
        ts.isStringLiteral(st.moduleSpecifier)
      ) {
        const names: string[] = [];
        let allTypes = st.isTypeOnly;
        if (st.exportClause && ts.isNamedExports(st.exportClause)) {
          const valueNames = st.exportClause.elements.filter((e) => !e.isTypeOnly);
          for (const e of valueNames) names.push((e.propertyName ?? e.name).text);
          if (valueNames.length === 0) allTypes = true;
        }
        add(st.moduleSpecifier.text, { typeOnly: allTypes, dynamic: false, reexport: true, names });
      } else if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
        // Seiteneffekt-Import (z. B. CSS) ohne Auflösung auf eine Quelldatei.
        add(st.moduleSpecifier.text, {
          typeOnly: false,
          dynamic: false,
          reexport: false,
          names: []
        });
      }
    }
  }
  return { files, edges, dynamicTargets, parsed };
}

/** Starke Zusammenhangskomponenten mit mehr als einem Knoten (Tarjan). */
function cycles(
  nodes: readonly string[],
  adj: ReadonlyMap<string, ReadonlySet<string>>
): string[][] {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const out: string[][] = [];
  const strong = (v: string): void => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v) as number, idx.get(w) as number));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop();
        if (w === undefined) break;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) out.push(comp);
    }
  };
  for (const n of nodes) if (!idx.has(n)) strong(n);
  return out;
}

export function check(cfg: PackageConfig): Violation[] {
  const { files, edges, dynamicTargets, parsed } = analyze(cfg);
  const out: Violation[] = [];
  const rel = (f: string): string => posix(relative(cfg.src, f));
  const folderOf = (f: string): string => posix(relative(cfg.src, dirname(f))) || ".";
  const isIndex = (f: string): boolean => /(^|[\\/])index\.tsx?$/.test(f);
  const skipped = (folder: string): boolean =>
    (cfg.skipFolders ?? []).some((s) => folder === s || folder.startsWith(`${s}/`));

  // (h) kein @/ in packages ohne Alias
  for (const e of edges) {
    if (e.to.startsWith("@alias:")) {
      out.push({
        kind: "alias-in-shared",
        message: `${cfg.name}: ${rel(e.from)} nutzt ${e.to.slice(7)}`
      });
    }
  }

  // (a) Zyklen über statische Wert-Importe (Dateiebene, einschließlich Barrels)
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.typeOnly || e.dynamic || e.to.startsWith("@alias:")) continue;
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    adj.get(e.from)?.add(e.to);
  }
  for (const comp of cycles(files.map(normalize), adj)) {
    out.push({
      kind: "cycle",
      message: `${cfg.name}: Zyklus ${comp.map(rel).sort().join(" <-> ")}`
    });
  }

  // (b) Unterordner-index.ts enthalten nur Re-Exporte
  for (const f of files) {
    if (!isIndex(f) || folderOf(f) === ".") continue;
    const sf = parsed.get(f);
    for (const st of sf?.statements ?? []) {
      const ok = ts.isExportDeclaration(st) && st.moduleSpecifier !== undefined;
      if (!ok) {
        out.push({
          kind: "barrel-logic",
          message: `${cfg.name}: ${rel(f)} enthält mehr als Re-Exporte`
        });
        break;
      }
    }
  }

  // Start-Code: statisch (ohne Typen und dynamische Importe) vom Einstieg erreichbar. Module, die nur
  // lazy erreichbar sind, dürfen untereinander direkt importieren und gehören in kein Barrel.
  const startSet = new Set<string>();
  if (cfg.entries?.length) {
    const known = new Set(files.map(normalize));
    const queue = cfg.entries.map((e) => normalize(join(cfg.src, e))).filter((e) => known.has(e));
    for (const e of queue) startSet.add(e);
    while (queue.length > 0) {
      const v = queue.pop() as string;
      for (const e of edges) {
        if (
          e.from !== v ||
          e.typeOnly ||
          e.dynamic ||
          e.to.startsWith("@alias:") ||
          startSet.has(e.to)
        )
          continue;
        startSet.add(e.to);
        queue.push(e.to);
      }
    }
  }
  const lazyOnly = (f: string): boolean => startSet.size > 0 && !startSet.has(f);

  const folderEdges = new Set<string>();
  for (const e of edges) {
    if (e.to.startsWith("@alias:") || e.dynamic || e.typeOnly) continue;
    const fromFolder = folderOf(e.from);
    const toFolder = folderOf(e.to);
    if (skipped(fromFolder) || skipped(toFolder)) continue;
    if (fromFolder === toFolder) {
      // (c) kein Import des eigenen Barrels
      if (isIndex(e.to) && !isIndex(e.from) && fromFolder !== ".") {
        out.push({
          kind: "own-barrel",
          message: `${cfg.name}: ${rel(e.from)} importiert das eigene Barrel`
        });
      }
      continue;
    }
    folderEdges.add(`${fromFolder}->${toFolder}`);
    // (d) ordnerübergreifend nur über das Barrel (Ausnahmen: Typen, dynamisch geladene Ziele, Wurzel)
    if (
      toFolder !== "." &&
      !isIndex(e.to) &&
      !dynamicTargets.has(e.to) &&
      !lazyOnly(e.to) &&
      !e.reexport
    ) {
      out.push({
        kind: "deep-import",
        message: `${cfg.name}: ${rel(e.from)} importiert ${rel(e.to)} am Barrel vorbei`
      });
    }
  }

  // (e) Schichtregeln als erlaubte Kantenliste
  if (cfg.allowedEdges) {
    const allowed = new Set(cfg.allowedEdges);
    for (const k of [...folderEdges].sort()) {
      if (!allowed.has(k))
        out.push({
          kind: "edge-not-allowed",
          message: `${cfg.name}: Ordnerkante ${k} ist nicht erlaubt`
        });
    }
  }

  // (f) keine Wert-Re-Exporte dynamisch geladener oder nur lazy erreichbarer Module in Barrels
  for (const e of edges) {
    if (
      !e.reexport ||
      e.typeOnly ||
      !isIndex(e.from) ||
      !(dynamicTargets.has(e.to) || lazyOnly(e.to))
    )
      continue;
    out.push({
      kind: "dynamic-reexport",
      message: `${cfg.name}: ${rel(e.from)} re-exportiert ${rel(e.to)} als Wert`
    });
  }
  return out;
}
