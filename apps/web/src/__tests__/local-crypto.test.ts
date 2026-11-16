import { describe, expect, it } from "vitest";
import {
  IV_BYTES,
  LOCAL_FORMAT_VERSION,
  LocalCipher,
  LocalCryptoError,
  buildAad,
  deriveLocalKey,
  isEnvelope
} from "../local-crypto.js";

const material = () => new Uint8Array(32).fill(7);
const salt = () => new Uint8Array(16).fill(3);

describe("deriveLocalKey (Issue #348)", () => {
  it("liefert einen nicht exportierbaren AES-GCM-Schlüssel und nullt das Material", async () => {
    const raw = material();
    const key = await deriveLocalKey(raw, salt());
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect(key.usages.sort()).toEqual(["decrypt", "encrypt"]);
    expect(raw.every((b) => b === 0)).toBe(true);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });

  it("lehnt falsche Längen ab und nullt trotzdem", async () => {
    const short = new Uint8Array(16).fill(9);
    await expect(deriveLocalKey(short, salt())).rejects.toMatchObject({ code: "key-material" });
    expect(short.every((b) => b === 0)).toBe(true);
    await expect(deriveLocalKey(material(), new Uint8Array(8))).rejects.toBeInstanceOf(
      LocalCryptoError
    );
  });

  it("anderes Salz oder Material ergibt einen anderen Schlüssel", async () => {
    const a = new LocalCipher(await deriveLocalKey(material(), salt()));
    const b = new LocalCipher(await deriveLocalKey(material(), new Uint8Array(16).fill(4)));
    const env = await a.encryptJson(buildAad("x", "1"), "geheim");
    await expect(b.decrypt(buildAad("x", "1"), env)).rejects.toMatchObject({ code: "decrypt" });
  });
});

describe("LocalCipher", () => {
  it("verschlüsselt mit frischer 96-Bit-Nonce und entschlüsselt wieder", async () => {
    const cipher = new LocalCipher(await deriveLocalKey(material(), salt()));
    const aad = buildAad("titles", "nb_1");
    const a = await cipher.encryptJson(aad, { title: "Geheimer Titel" });
    const b = await cipher.encryptJson(aad, { title: "Geheimer Titel" });
    expect(a.v).toBe(LOCAL_FORMAT_VERSION);
    expect(a.iv.byteLength).toBe(IV_BYTES);
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ct).not.toEqual(b.ct);
    expect(new TextDecoder().decode(a.ct)).not.toContain("Geheimer");
    expect(await cipher.decryptJson(aad, a)).toEqual({ title: "Geheimer Titel" });
  });

  it("AAD bindet Bereich und ID: vertauschte Datensätze fallen auf", async () => {
    const cipher = new LocalCipher(await deriveLocalKey(material(), salt()));
    const env = await cipher.encryptJson(buildAad("titles", "nb_1"), "x");
    await expect(cipher.decrypt(buildAad("titles", "nb_2"), env)).rejects.toMatchObject({
      code: "decrypt"
    });
    await expect(cipher.decrypt(buildAad("outbox", "nb_1"), env)).rejects.toMatchObject({
      code: "decrypt"
    });
  });

  it("erkennt manipuliertes Chiffrat", async () => {
    const cipher = new LocalCipher(await deriveLocalKey(material(), salt()));
    const aad = buildAad("a", "b");
    const env = await cipher.encrypt(aad, new Uint8Array([1, 2, 3]));
    const ct = env.ct.slice();
    ct[0] = (ct[0] ?? 0) ^ 1;
    await expect(cipher.decrypt(aad, { ...env, ct })).rejects.toMatchObject({ code: "decrypt" });
  });

  it("lehnt fremde Formate ab", async () => {
    const cipher = new LocalCipher(await deriveLocalKey(material(), salt()));
    for (const bad of [
      null,
      "x",
      { v: 2, iv: new Uint8Array(12), ct: new Uint8Array(1) },
      { v: 1, iv: new Uint8Array(8), ct: new Uint8Array(1) },
      { v: 1, iv: [1], ct: new Uint8Array(1) },
      { v: 1, iv: new Uint8Array(12), ct: "x" }
    ]) {
      expect(isEnvelope(bad)).toBe(false);
      await expect(cipher.decrypt(buildAad("a", "b"), bad)).rejects.toMatchObject({
        code: "format"
      });
    }
  });

  it("verweigert nach der Nonce-Obergrenze weitere Verschlüsselungen", async () => {
    const seen: Uint8Array[] = [];
    const cipher = new LocalCipher(await deriveLocalKey(material(), salt()), {
      maxEncryptions: 2,
      randomFill: (bytes) => {
        bytes.fill(seen.length + 1);
        seen.push(bytes);
      }
    });
    const aad = buildAad("a", "b");
    await cipher.encrypt(aad, new Uint8Array([1]));
    await cipher.encrypt(aad, new Uint8Array([1]));
    await expect(cipher.encrypt(aad, new Uint8Array([1]))).rejects.toMatchObject({
      code: "nonce-limit"
    });
    expect(seen).toHaveLength(2);
  });

  it("AAD ist eindeutig, auch wenn Werte Trennzeichen enthalten", () => {
    expect(buildAad("a|b", "c")).not.toEqual(buildAad("a", "b|c"));
  });
});
