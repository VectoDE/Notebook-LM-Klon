/**
 * Liest einen Request-Körper streamend und bricht ab, sobald mehr als maxBytes ankommen.
 *
 * Der Content-Length-Header allein begrenzt nichts: Ein Client kann ihn weglassen oder falsch
 * angeben. Deshalb wird beim Lesen gezählt. Liefert null, wenn die Grenze überschritten wurde.
 */
export async function readBodyLimited(req: Request, maxBytes: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
