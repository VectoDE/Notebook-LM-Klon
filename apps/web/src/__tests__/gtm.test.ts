import { describe, expect, it } from "vitest";
import { injectSiteVerification } from "../analytics-config.js";
import { CONSENT_VERSION, type ConsentState } from "../consent.js";
import {
  CONSENT_DEFAULTS,
  type GtmDocument,
  type GtmGlobal,
  type GtmScript,
  gtmConsentHandler,
  removeAnalyticsCookies
} from "../gtm.js";

function fakeDocument(cookie = "", hostname = "app.example.org") {
  const scripts: GtmScript[] = [];
  const writes: string[] = [];
  let jar = cookie;
  const doc: GtmDocument = {
    get cookie() {
      return jar;
    },
    set cookie(value: string) {
      writes.push(value);
      jar = "";
    },
    location: { hostname },
    getElementById: (id) => scripts.find((s) => s.id === id) ?? null,
    createElement: () => ({ async: false, src: "", id: "" }),
    head: {
      appendChild: (node) => {
        scripts.push(node);
        return node;
      }
    }
  };
  return { doc, scripts, writes };
}

const granted: ConsentState = {
  version: CONSENT_VERSION,
  analytics: true,
  decidedAt: "2026-11-13T00:00:00.000Z"
};
const denied: ConsentState = { ...granted, analytics: false };

/** Wandelt die arguments-Objekte im dataLayer in Arrays um. */
function commands(win: GtmGlobal): unknown[] {
  return (win.dataLayer ?? []).map((entry) =>
    typeof entry === "object" && entry !== null && "length" in entry
      ? Array.from(entry as ArrayLike<unknown>)
      : entry
  );
}

describe("Google Tag Manager nur nach Einwilligung (Issue #260)", () => {
  it("lädt ohne gültige Container-ID oder ohne Dokument gar nichts", () => {
    const { doc } = fakeDocument();
    expect(gtmConsentHandler(undefined, { document: doc })).toBeUndefined();
    expect(gtmConsentHandler("G-12345", { document: doc })).toBeUndefined();
    expect(gtmConsentHandler("GTM-ABC1234", {})).toBeUndefined();
  });

  it("lädt ohne Einwilligung kein Skript und legt keinen dataLayer an", () => {
    const { doc, scripts } = fakeDocument();
    const win: GtmGlobal = { document: doc };
    gtmConsentHandler("GTM-ABC1234", win)?.(denied);
    expect(scripts).toEqual([]);
    expect(win.dataLayer).toBeUndefined();
    expect(win.gtag).toBeUndefined();
  });

  it("setzt Consent Mode v2 zuerst auf denied und lädt gtm.js nach Einwilligung genau einmal", () => {
    const { doc, scripts } = fakeDocument();
    const win: GtmGlobal = { document: doc };
    const handle = gtmConsentHandler("GTM-ABC1234", win, () => 42);
    handle?.(granted);
    handle?.(granted);

    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toEqual({
      id: "rn-gtm",
      async: true,
      src: "https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234"
    });
    const log = commands(win);
    expect(log[0]).toEqual(["consent", "default", { ...CONSENT_DEFAULTS }]);
    expect(log[1]).toEqual(["consent", "update", { analytics_storage: "granted" }]);
    expect(log[2]).toEqual({ "gtm.start": 42, event: "gtm.js" });
    // Werbesignale bleiben immer verweigert
    expect(CONSENT_DEFAULTS.ad_storage).toBe("denied");
    expect(CONSENT_DEFAULTS.ad_user_data).toBe("denied");
    expect(CONSENT_DEFAULTS.ad_personalization).toBe("denied");
  });

  it("nutzt einen vorhandenen gtag und legt bei Bedarf den dataLayer an", () => {
    const { doc, scripts } = fakeDocument();
    const calls: unknown[][] = [];
    const win: GtmGlobal = { document: doc, gtag: (...args) => calls.push(args) };
    gtmConsentHandler("GTM-ABC1234", win)?.(granted);
    expect(calls).toEqual([["consent", "update", { analytics_storage: "granted" }]]);
    expect(scripts).toHaveLength(1);
  });

  it("widerruft: setzt analytics_storage auf denied und löscht _ga-Cookies", () => {
    const { doc, writes } = fakeDocument("_ga=GA1.1.1; _ga_ABC=GS1; _gid=x; rn-theme=dark");
    const win: GtmGlobal = { document: doc };
    const handle = gtmConsentHandler("GTM-ABC1234", win);
    handle?.(granted);
    handle?.(denied);
    expect(commands(win).at(-1)).toEqual(["consent", "update", { analytics_storage: "denied" }]);
    expect(writes.map((w) => w.split("=")[0])).toEqual([
      "_ga",
      "_ga",
      "_ga",
      "_ga_ABC",
      "_ga_ABC",
      "_ga_ABC",
      "_gid",
      "_gid",
      "_gid"
    ]);
    expect(writes[2]).toContain("domain=.example.org");
    expect(writes.join(" ")).not.toContain("rn-theme");
  });

  it("findet ohne Analytics-Cookies nichts zu löschen", () => {
    const { doc, writes } = fakeDocument("");
    expect(removeAnalyticsCookies(doc)).toEqual([]);
    expect(writes).toEqual([]);
  });
});

describe("Search-Console-Bestätigung per Umgebungsvariable (Issue #260)", () => {
  const html = "<html><head><title>x</title></head><body></body></html>";

  it("fügt das Meta-Tag nur mit gültigem Token ein", () => {
    const out = injectSiteVerification(html, "abcDEF123_-xyz");
    expect(out).toContain('<meta name="google-site-verification" content="abcDEF123_-xyz" />');
    expect(out.indexOf("google-site-verification")).toBeLessThan(out.indexOf("</head>"));
  });

  it("lässt das HTML ohne oder mit ungültigem Token unverändert", () => {
    expect(injectSiteVerification(html, undefined)).toBe(html);
    expect(injectSiteVerification(html, '"><script>')).toBe(html);
  });
});
