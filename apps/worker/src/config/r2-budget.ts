/**
 * R2-Budget für eigene Uploads (Entscheidung F247): eigener Bucket `notebook-lm-media`,
 * Verbrauch innerhalb der Cloudflare-Freimenge, mit Größen- und Anzahlgrenzen je Upload.
 *
 * Freimenge laut https://developers.cloudflare.com/r2/pricing/ (abgerufen am 2026-11-14):
 * 10 GB-Monat Standard-Speicher, 1 Mio. Class-A- und 10 Mio. Class-B-Operationen je Monat,
 * Egress kostenlos. PutObject und ListObjects sind Class A, GetObject und HeadObject Class B,
 * DeleteObject ist kostenlos. Ein GB-Monat ist der Durchschnitt des täglichen Höchststands
 * über 30 Tage; Cloudflare rundet auf.
 *
 * Wir planen mit der Hälfte der Freimenge, damit Rundung, verwaiste Objekte und andere
 * Nutzung desselben Kontos Platz haben. Rechnung: docs/platform-limits.md, Abschnitt 5.
 */

/** Freimenge laut Cloudflare-Doku. „GB“ dezimal gerechnet, das ist die kleinere Lesart. */
export const R2_FREE_TIER = {
  storageBytes: 10_000_000_000,
  classAOpsPerMonth: 1_000_000,
  classBOpsPerMonth: 10_000_000,
  source: "https://developers.cloudflare.com/r2/pricing/",
  retrievedAt: "2026-11-14"
} as const;

/** Anteil der Freimenge, den die App höchstens einplant. */
export const R2_BUDGET_SHARE = 0.5;

/** Obergrenze für den gesamten belegten R2-Speicher aller Quellen (5 GB). */
export const R2_STORAGE_BUDGET_BYTES = R2_FREE_TIER.storageBytes * R2_BUDGET_SHARE;

/** Uploads je UTC-Tag über alle Nutzer. */
export const MAX_UPLOADS_PER_DAY = 1_000;

/** Hochgeladene Bytes je UTC-Tag über alle Nutzer (2 GB). */
export const MAX_UPLOAD_BYTES_PER_DAY = 2_000_000_000;

/** Speicher je angemeldetem Nutzer (Summe byte_size seiner Notebooks), 500 MB. */
export const MAX_USER_STORAGE_BYTES = 500 * 1024 * 1024;

/** Speicher je Gast (Summe byte_size seiner Notebooks), 100 MB; Gäste verfallen nach 24 h. */
export const MAX_GUEST_STORAGE_BYTES = 100 * 1024 * 1024;

/** Ab diesem Alter gilt ein Upload im Status „uploading“ als abgebrochen (1 h). */
export const STALE_UPLOAD_MS = 60 * 60 * 1000;

/** Zähler-Zeilen älter als diese Anzahl Tage räumt der Cron weg. */
export const UPLOAD_DAILY_RETENTION_DAYS = 7;

/**
 * Höchstens anfallende R2-Operationen je Upload: Class A = PutObject + ein ListObjects beim
 * späteren Aufräumen; Class B = ein GetObject (erste 512 Bytes) beim Abschluss.
 * Downloads (GET /sources/:id/file) kommen dazu und sind nur über das Rate-Limit begrenzt.
 */
export const R2_OPS_PER_UPLOAD = { classA: 2, classB: 1 } as const;

export interface R2BudgetLimits {
  readonly storageBytes: number;
  readonly uploadsPerDay: number;
  readonly uploadBytesPerDay: number;
}

/** Grenzen des Profils `demo` (Cloudflare Free). */
export const FREE_TIER_R2_BUDGET: R2BudgetLimits = {
  storageBytes: R2_STORAGE_BUDGET_BYTES,
  uploadsPerDay: MAX_UPLOADS_PER_DAY,
  uploadBytesPerDay: MAX_UPLOAD_BYTES_PER_DAY
};

export type UploadBudgetDenial = "STORAGE_BUDGET_EXHAUSTED" | "UPLOAD_DAILY_LIMIT_REACHED";

export type UploadBudgetResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: UploadBudgetDenial };

/**
 * Prüft den globalen Speicher und bucht einen Upload auf den Tageszähler.
 * Der Tageszähler wird mit einem bedingten UPSERT atomar erhöht: Ist die Grenze erreicht,
 * ändert die Anweisung keine Zeile und der Upload wird abgelehnt.
 */
export async function reserveUploadBudget(
  db: D1Database,
  byteSize: number,
  limits: R2BudgetLimits | null,
  now: Date = new Date()
): Promise<UploadBudgetResult> {
  if (limits === null) {
    return { ok: true };
  }

  const usage = await db
    .prepare("SELECT stored_bytes FROM r2_usage WHERE id = 1")
    .first<{ stored_bytes: number }>();
  const storedBytes = Number(usage?.stored_bytes ?? 0);
  if (storedBytes + byteSize > limits.storageBytes) {
    return { ok: false, code: "STORAGE_BUDGET_EXHAUSTED" };
  }

  if (byteSize > limits.uploadBytesPerDay || limits.uploadsPerDay < 1) {
    return { ok: false, code: "UPLOAD_DAILY_LIMIT_REACHED" };
  }

  const day = now.toISOString().slice(0, 10);
  const result = await db
    .prepare(
      `INSERT INTO upload_daily (day, uploads, bytes) VALUES (?, 1, ?)
       ON CONFLICT(day) DO UPDATE SET
         uploads = upload_daily.uploads + 1,
         bytes = upload_daily.bytes + excluded.bytes
       WHERE upload_daily.uploads + 1 <= ? AND upload_daily.bytes + excluded.bytes <= ?`
    )
    .bind(day, byteSize, limits.uploadsPerDay, limits.uploadBytesPerDay)
    .run();

  if (Number(result.meta.changes) === 0) {
    return { ok: false, code: "UPLOAD_DAILY_LIMIT_REACHED" };
  }
  return { ok: true };
}

/** Sekunden bis zum nächsten UTC-Tagesbeginn, für den Retry-After-Header. */
export function secondsUntilNextUtcDay(now: Date = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

export class UploadTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Upload ist größer als ${maxBytes} Bytes.`);
    this.name = "UploadTooLargeError";
  }
}

/**
 * Zählt die Bytes eines Upload-Streams und bricht ab, sobald mehr als maxBytes ankommen.
 * Der Content-Length-Header allein begrenzt nichts, deshalb wird beim Streamen gezählt.
 */
export function limitStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number
): ReadableStream<Uint8Array> {
  let total = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          controller.error(new UploadTooLargeError(maxBytes));
          return;
        }
        controller.enqueue(chunk);
      }
    })
  );
}
