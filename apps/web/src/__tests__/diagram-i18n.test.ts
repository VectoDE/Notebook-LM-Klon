import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type DiagramStrings,
  autoLanguageSvg,
  buildDiagramVariants,
  decodeXml,
  encodeXml,
  extractTexts,
  localizeSvg,
  resolveSwitches,
  switchChildren,
  variantFileName
} from "../diagram-i18n.js";

const assets = resolve(import.meta.dirname, "../../../../docs/assets");
const catalog = JSON.parse(readFileSync(resolve(assets, "i18n/strings.json"), "utf8")) as Record<
  string,
  DiagramStrings
>;
const sourceFiles = readdirSync(resolve(assets, "src")).filter((f) => f.endsWith(".svg"));
const sources = Object.fromEntries(
  sourceFiles.map((f) => [f, readFileSync(resolve(assets, "src", f), "utf8")])
);
const readme = readFileSync(resolve(assets, "../../README.md"), "utf8");

const mini: DiagramStrings = {
  title: { de: "Titel", en: "Title" },
  desc: { de: "Beschreibung", en: "Description" },
  texts: {
    t01: { de: "Quellen & Zitate", en: "Sources & citations" },
    t02: { de: "RAG", en: "RAG" }
  }
};
const miniSvg =
  '<svg xmlns="http://www.w3.org/2000/svg"><title id="t">Titel</title><desc>Beschreibung</desc>' +
  '<text x="1" y="2">Quellen &amp; Zitate</text><text x="3">RAG</text></svg>';

describe("Diagramme Deutsch/Englisch (Issue #354)", () => {
  it("hält alle Ausgaben synchron zu Quellen und Katalog", () => {
    const built = buildDiagramVariants(sources, catalog);
    expect(built.size).toBe(sourceFiles.length * 3);
    for (const [file, svg] of built) {
      expect(readFileSync(resolve(assets, file), "utf8"), file).toBe(svg);
    }
  });

  it("führt jeden Text mit deutscher und englischer Fassung, ohne Lücken", () => {
    const names = Object.keys(catalog);
    expect(names.sort()).toEqual(
      [
        "architecture-overview",
        "hero-banner",
        "rag-pipeline",
        "relationflow-bridge",
        "security-layers"
      ].sort()
    );
    for (const [name, strings] of Object.entries(catalog)) {
      for (const phrase of [strings.title, strings.desc, ...Object.values(strings.texts)]) {
        expect(phrase.de.trim().length, name).toBeGreaterThan(0);
        expect(phrase.en.trim().length, name).toBeGreaterThan(0);
      }
      // Alt-Texte (title/desc) in beiden Sprachen verschieden, wo der Inhalt Sprache trägt
      expect(strings.desc.de).not.toBe(strings.desc.en);
    }
  });

  it("englische Fassungen enthalten keinen deutschen Diagrammtext und tragen lang=en", () => {
    for (const file of readdirSync(assets).filter((f) => /-en(-light|-dark)?\.svg$/.test(f))) {
      const svg = readFileSync(resolve(assets, file), "utf8");
      expect(svg, file).toContain('<svg lang="en"');
      expect(svg, file).not.toContain("systemLanguage");
      expect(svg).not.toMatch(/[äöüÄÖÜß]/);
    }
    for (const file of readdirSync(assets).filter((f) => /-de(-light|-dark)?\.svg$/.test(f))) {
      expect(readFileSync(resolve(assets, file), "utf8"), file).toContain('<svg lang="de"');
    }
  });

  it("verlinkt in der README je Grafik die deutsche und die englische Fassung", () => {
    for (const name of Object.keys(catalog)) {
      expect(readme).toContain(`docs/assets/${name}-de.svg`);
      expect(readme).toContain(`docs/assets/${name}-en.svg`);
    }
  });

  it("maskiert und dekodiert XML-Inhalte verlustfrei", () => {
    expect(encodeXml('a & b < c > "d"')).toBe('a &amp; b &lt; c &gt; "d"');
    expect(decodeXml("&amp;&lt;&gt;&quot;&apos;&#228;&#xE4;&unknown;")).toBe("&<>\"'ää&unknown;");
    expect(extractTexts(miniSvg)).toEqual(["Quellen & Zitate", "RAG"]);
  });

  it("erzeugt einsprachige Fassungen mit übersetztem Titel, Beschreibung und Text", () => {
    const en = localizeSvg(miniSvg, mini, "en");
    expect(en).toContain('<svg lang="en"');
    expect(en).toContain('<title id="t">Title</title><desc>Description</desc>');
    expect(en).toContain('<text x="1" y="2">Sources &amp; citations</text>');
    expect(localizeSvg(miniSvg, mini, "de")).toContain("Quellen &amp; Zitate");
  });

  it("erzeugt die automatische Fassung mit systemLanguage und englischem Rückfall", () => {
    const auto = autoLanguageSvg(miniSvg, mini);
    expect(auto).toContain('<title id="t">Title / Titel</title>');
    expect(auto).toContain(
      '<switch><text systemLanguage="de" x="1" y="2">Quellen &amp; Zitate</text><text x="1" y="2">Sources &amp; citations</text></switch>'
    );
    // gleicher Text in beiden Sprachen bleibt ein einzelnes Element
    expect(auto).toContain('<text x="3">RAG</text>');
  });

  it("löst <switch> auf den passenden Zweig auf, sonst auf den Rückfall", () => {
    const svg =
      '<svg><switch><g systemLanguage="de"><g class="a"><text>Hallo</text></g></g><g><text>Hello</text></g><g/></switch></svg>';
    expect(switchChildren(svg.slice(13, -15))).toHaveLength(2);
    expect(resolveSwitches(svg, "de")).toBe(
      '<svg><g><g class="a"><text>Hallo</text></g></g></svg>'
    );
    expect(resolveSwitches(svg, "en")).toBe("<svg><g><text>Hello</text></g></svg>");
    expect(() =>
      resolveSwitches('<svg><switch><g systemLanguage="fr"></g></switch></svg>', "en")
    ).toThrow("ohne Zweig");
  });

  it("bricht ab, wenn Quelle und Katalog nicht zusammenpassen", () => {
    expect(() => localizeSvg(miniSvg.replace("RAG", "KI"), mini, "en")).toThrow(
      "weicht vom Katalog ab"
    );
    expect(() => localizeSvg(miniSvg.replace("Titel<", "Anders<"), mini, "en")).toThrow("<title>");
    expect(() => localizeSvg(miniSvg.replace(/<desc>.*<\/desc>/, ""), mini, "en")).toThrow(
      "<desc> fehlt"
    );
    expect(() => localizeSvg(`${miniSvg}<text>mehr</text>`, mini, "en")).toThrow(
      "Katalog hat 2 Texte"
    );
    expect(() => buildDiagramVariants({ "unbekannt.svg": miniSvg }, { demo: mini })).toThrow(
      "Kein Katalogeintrag"
    );
  });

  it("benennt Ausgaben nach Sprache und Farbmodus", () => {
    const names = ["rag-pipeline", "hero-banner"];
    expect(variantFileName("rag-pipeline-dark.svg", names, "en")).toBe("rag-pipeline-en-dark.svg");
    expect(variantFileName("hero-banner.svg", names, "de")).toBe("hero-banner-de.svg");
    expect(variantFileName("hero-banner-light.svg", names, "auto")).toBe("hero-banner-light.svg");
    expect(() => variantFileName("x.svg", names, "de")).toThrow("Unbekannte Quelldatei");
  });
});
