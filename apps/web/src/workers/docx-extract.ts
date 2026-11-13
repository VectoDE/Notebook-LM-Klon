/**
 * DOCX-Auszug für den Ingest-Worker (Issue #152).
 *
 * mammoth wird erst beim ersten DOCX per dynamischem import() geladen und landet so in
 * einem eigenen Chunk statt im Start-Bundle. mammoth liefert schlichtes, geprüftes HTML
 * (h1 bis h6, p, ul/ol/li, table/tr/td); daraus entstehen hier strukturierte Blöcke und
 * ein Markdown-Text, der Überschriften-Kontext, Listen und Tabellenzeilen behält.
 */

export type DocxBlockKind = "heading" | "paragraph" | "list-item" | "table-row";

export interface DocxBlock {
  readonly kind: DocxBlockKind;
  /** Überschriftenebene 1 bis 6, sonst 0. */
  readonly level: number;
  /** Nur bei Listenpunkten: nummerierte (ol) oder Aufzählungsliste (ul). */
  readonly ordered?: boolean | undefined;
  /** Bei Tabellenzeilen die Zellen, sonst leer. */
  readonly cells?: readonly string[] | undefined;
  readonly text: string;
}

/** Wandelt eine DOCX-Datei in HTML um (Standard: mammoth, in Tests austauschbar). */
export type DocxHtmlConverter = (data: Uint8Array) => Promise<string>;

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};

/** Löst die Entitäten auf, die mammoth beim Escapen schreibt (benannt und numerisch). */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Macht aus einem HTML-Ausschnitt reinen Text. Nach dem Entfernen der Tags werden übrige spitze
 * Klammern (nur aus kaputten Tags möglich, echter Text kommt von mammoth als &lt;/&gt;) gestrichen,
 * damit keine Tag-Reste wie "<script" stehen bleiben. Erst danach werden Entitäten aufgelöst.
 */
function cleanText(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, "").replace(/[<>]/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

const BLOCK_TAG = /<(\/?)(h[1-6]|p|li|ul|ol|tr|td|th)\b[^>]*>/gi;

/**
 * Zerlegt das HTML von mammoth in Blöcke. Text steht immer in einem Blockelement;
 * Absätze in Listenpunkten oder Tabellenzellen gehören zum umgebenden Punkt bzw. zur Zelle.
 */
export function docxHtmlToBlocks(html: string): DocxBlock[] {
  const blocks: DocxBlock[] = [];
  const listStack: boolean[] = [];
  let cells: string[] | null = null;
  let cellText: string | null = null;
  let leaf: { tag: string; text: string } | null = null;
  let lastIndex = 0;

  const pushLeaf = () => {
    if (!leaf) return;
    const text = cleanText(leaf.text);
    if (text.length > 0) {
      if (leaf.tag === "li") {
        blocks.push({ kind: "list-item", level: 0, ordered: listStack.at(-1) === true, text });
      } else if (leaf.tag === "p") {
        blocks.push({ kind: "paragraph", level: 0, text });
      } else {
        blocks.push({ kind: "heading", level: Number(leaf.tag.slice(1)), text });
      }
    }
    leaf = null;
  };

  for (const match of html.matchAll(BLOCK_TAG)) {
    const between = html.slice(lastIndex, match.index);
    lastIndex = match.index + match[0].length;
    if (cellText !== null) cellText += between;
    else if (leaf) leaf.text += between;

    const closing = match[1] === "/";
    const tag = (match[2] as string).toLowerCase();

    if (tag === "ul" || tag === "ol") {
      pushLeaf();
      if (closing) listStack.pop();
      else listStack.push(tag === "ol");
    } else if (tag === "tr") {
      if (closing && cells) {
        const row = cells.filter((c) => c.length > 0);
        if (row.length > 0) {
          blocks.push({ kind: "table-row", level: 0, cells, text: cells.join(" | ") });
        }
        cells = null;
      } else if (!closing) {
        cells = [];
      }
    } else if (tag === "td" || tag === "th") {
      if (closing && cellText !== null) {
        cells?.push(cleanText(cellText));
        cellText = null;
      } else if (!closing) {
        cellText = "";
      }
    } else if (cellText === null) {
      // p, li, h1–h6 außerhalb von Tabellen
      if (closing) {
        if (leaf?.tag === tag) pushLeaf();
      } else if (tag === "li" || !leaf || leaf.tag !== "li") {
        pushLeaf();
        leaf = { tag, text: "" };
      }
    }
  }
  pushLeaf();
  return blocks;
}

/**
 * Schreibt die Blöcke als Markdown: Überschriften mit #, Listen mit - bzw. 1., Tabellen als
 * Zeilen mit |. So greift im Parser derselbe Überschriften-Kontext wie bei Markdown-Dateien.
 */
export function docxBlocksToMarkdown(blocks: readonly DocxBlock[]): string {
  const lines: string[] = [];
  let counter = 0;
  let previous: DocxBlock | undefined;
  for (const block of blocks) {
    const sameGroup =
      previous !== undefined &&
      previous.kind === block.kind &&
      (block.kind === "list-item" || block.kind === "table-row");
    if (lines.length > 0) lines.push(sameGroup ? "\n" : "\n\n");
    if (block.kind === "heading") {
      lines.push(`${"#".repeat(block.level)} ${block.text}`);
    } else if (block.kind === "list-item") {
      counter = sameGroup && previous?.ordered === block.ordered ? counter + 1 : 1;
      lines.push(block.ordered ? `${counter}. ${block.text}` : `- ${block.text}`);
    } else if (block.kind === "table-row") {
      lines.push(`| ${block.text} |`);
    } else {
      lines.push(block.text);
    }
    previous = block;
  }
  return lines.join("");
}

/** Standard-Umwandlung mit mammoth, erst bei Bedarf geladen. */
export const convertDocxWithMammoth: DocxHtmlConverter = async (data) => {
  const mammoth = await import("mammoth");
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  // Browser-Build liest arrayBuffer, der Node-Build (Tests) liest buffer
  const result = await mammoth.convertToHtml({ arrayBuffer, buffer: data } as {
    arrayBuffer: ArrayBuffer;
  });
  return result.value;
};

/** Liest eine DOCX-Datei und gibt Blöcke sowie den daraus gebauten Markdown-Text zurück. */
export async function extractDocx(
  data: Uint8Array,
  convert: DocxHtmlConverter = convertDocxWithMammoth
): Promise<{ blocks: DocxBlock[]; markdown: string }> {
  const html = await convert(data);
  const blocks = docxHtmlToBlocks(html);
  if (blocks.length === 0) {
    throw new Error("Die Word-Datei enthält keinen lesbaren Text.");
  }
  return { blocks, markdown: docxBlocksToMarkdown(blocks) };
}
