import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { DESIGNS, openPanel } from "./helpers";

/**
 * Issue #279: Wurzelbeschriftung und Notebook-Titel der Mindmap werden nicht abgeschnitten,
 * auch nicht bei langen Titeln, in Deutsch und Englisch, auf Desktop und Telefon, in allen
 * vier Designs.
 * Die Werkzeugknöpfe sind mindestens 44 x 44 px groß und liegen mit Abstand nebeneinander.
 *
 * Mit MINDMAP_SHOTS_DIR=<Ordner> legt die Prüfung je Fall ein Bildschirmfoto ab
 * (Beleg vorher/nachher, wird nicht eingecheckt).
 */

const TITLES = {
  de: "Grundlagen der verteilten Datenhaltung mit Durable Objects, D1 und R2: Datenschutzfolgenabschätzungsverfahren",
  en: "Fundamentals of distributed data storage with Durable Objects, D1 and R2: privacy impact assessment procedures"
} as const;

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 }
} as const;

/** Wurzel der Demo-Mindmap; lange Beschriftungen prüfen die Unit-Tests (Umbruch). */
const ROOT_LABEL = "Cloudflare Edge Stack";

/** Mindestabstand zwischen zwei benachbarten Werkzeugknöpfen in px. */
const MIN_GAP = 8;

async function openMindmap(page: Page, design: string, lang: "de" | "en", title: string) {
  await page.addInitScript(
    ([d, l, t]) => {
      localStorage.setItem("rn_design", d);
      localStorage.setItem("rn_language", l);
      localStorage.setItem("rn_notebook_titles", JSON.stringify({ nb_active: t }));
    },
    [design, lang, title] as const
  );
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-design", design);
  await openPanel(page, "studio");
  await page.getByTestId("btn-open-mindmap-tool").click();
  await expect(page.locator(".rn-mindmap")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

/** Knoten der Grafik, deren Text über den Rahmen (oder in den Knopf) hinausragt. */
function clippedNodes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    for (const node of document.querySelectorAll<SVGGElement>(".rn-mm-node")) {
      const rect = node.querySelector<SVGRectElement>(".rn-mm-box");
      const text = node.querySelector<SVGTextElement>(".rn-mm-label");
      if (!rect || !text) continue;
      const box = rect.getBBox();
      const label = text.getBBox();
      // Rechts liegt bei Zweigen der Knopf (Mitte 20 px vom Rand, Radius 12 px)
      const right = node.querySelector(".rn-mm-toggle") ? box.width - 32 : box.width;
      if (
        label.x < 0 ||
        label.y < 0 ||
        label.x + label.width > right + 0.5 ||
        label.y + label.height > box.height + 0.5
      ) {
        found.push(
          `${text.textContent} (${Math.round(label.x + label.width)} > ${Math.round(right)})`
        );
      }
    }
    return found;
  });
}

for (const design of DESIGNS) {
  for (const lang of ["de", "en"] as const) {
    for (const [device, viewport] of Object.entries(VIEWPORTS)) {
      test(`${design}, ${lang}, ${device}: langer Titel und Wurzel vollständig, Knöpfe 44 px mit Abstand`, async ({
        page
      }) => {
        await page.setViewportSize(viewport);
        const title = TITLES[lang];
        await openMindmap(page, design, lang, title);

        // Der lange Notebook-Titel steht vollständig und ohne Überlauf über der Mindmap
        const heading = page.getByTestId("studio-panel").getByText(title, { exact: true });
        await expect(heading).toBeVisible();
        const headingFits = await heading.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
        expect(headingFits, "Titel ohne Überlauf").toBe(true);

        // Telefon startet in der Baumliste: dort steht die Wurzel vollständig
        const tree = page.getByRole("tree");
        if (device === "mobile") {
          await expect(tree).toBeVisible();
          const first = tree.getByRole("treeitem").first();
          await expect(first.locator("strong")).toHaveText(ROOT_LABEL);
          const fits = await first.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
          expect(fits, "Baumliste ohne Überlauf").toBe(true);
        }

        const visualTab = page.getByRole("tab", { name: lang === "de" ? "Grafik" : "Graphic" });
        await visualTab.click();
        const root = page.locator('.rn-mm-node[data-kind="root"] .rn-mm-label');
        await expect(root).toBeVisible();
        const dir = process.env.MINDMAP_SHOTS_DIR;
        if (dir) {
          mkdirSync(dir, { recursive: true });
          await page
            .locator(".rn-mindmap")
            .screenshot({ path: join(dir, `${design}-${lang}-${device}.png`) });
        }
        const rootText = (await root.textContent()) ?? "";
        expect(rootText.replace(/\s+/g, "")).toBe(ROOT_LABEL.replace(/\s+/g, ""));
        expect(await clippedNodes(page)).toEqual([]);

        // Langer Titel als Wurzel: dieselbe Berechnung wie die Komponente, im Browser mit der
        // Schrift des Designs gemessen (Wurzelknoten mit Knopf, Text ab x = 16, Knopf ab Breite - 32)
        const longRoot = await page.evaluate(async (label) => {
          const modulePath = "/src/MindmapViewer.tsx";
          const viewer = await import(/* @vite-ignore */ modulePath);
          const size = viewer.nodeSizeFor(label, true, viewer.createTextMeasure(document));
          const rootNode = document.querySelector('.rn-mm-node[data-kind="root"]');
          const probe = document.createElementNS("http://www.w3.org/2000/svg", "text");
          probe.setAttribute("class", "rn-mm-label");
          rootNode?.appendChild(probe);
          const widths = (size.lines as string[]).map((line) => {
            probe.textContent = line;
            return probe.getComputedTextLength();
          });
          probe.remove();
          return {
            lines: size.lines as string[],
            width: size.width as number,
            widest: Math.max(...widths)
          };
        }, title);
        expect(longRoot.lines.length, "langer Titel bricht um").toBeGreaterThan(1);
        expect(longRoot.lines.join("").replace(/\s+/g, "")).toBe(title.replace(/\s+/g, ""));
        expect(16 + longRoot.widest, "Zeile passt vor den Knopf").toBeLessThanOrEqual(
          longRoot.width - 32 + 0.5
        );

        if (dir) {
          // Beleg: die Wurzel kurz mit dem langen Titel zeichnen, genau wie die Komponente
          // (Rahmen, Zeilen, Knopf), Bild aufnehmen, Original wiederherstellen
          await page.evaluate(async (label) => {
            const modulePath = "/src/MindmapViewer.tsx";
            const viewer = await import(/* @vite-ignore */ modulePath);
            const size = viewer.nodeSizeFor(label, true, viewer.createTextMeasure(document));
            const original = document.querySelector<SVGGElement>('.rn-mm-node[data-kind="root"]');
            if (!original) return;
            const copy = original.cloneNode(true) as SVGGElement;
            copy.dataset.probe = "lange-wurzel";
            copy.querySelector(".rn-mm-box")?.setAttribute("width", String(size.width));
            copy.querySelector(".rn-mm-box")?.setAttribute("height", String(size.height));
            const text = copy.querySelector(".rn-mm-label");
            if (text) {
              const lines = size.lines as string[];
              text.setAttribute("y", String(size.height / 2 + 5 - ((lines.length - 1) * 20) / 2));
              text.replaceChildren(
                ...lines.map((line, index) => {
                  const span = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
                  span.setAttribute("x", "16");
                  span.setAttribute("dy", index === 0 ? "0" : "20");
                  span.textContent = line;
                  return span;
                })
              );
            }
            copy
              .querySelector(".rn-mm-toggle")
              ?.setAttribute("transform", `translate(${size.width - 20}, ${size.height / 2})`);
            original.style.display = "none";
            original.after(copy);
          }, title);
          await page
            .locator(".rn-mindmap")
            .screenshot({ path: join(dir, `${design}-${lang}-${device}-lange-wurzel.png`) });
          await page.evaluate(() => {
            document.querySelector('[data-probe="lange-wurzel"]')?.remove();
            const original = document.querySelector<SVGGElement>('.rn-mm-node[data-kind="root"]');
            if (original) original.style.display = "";
          });
        }

        // Werkzeugknöpfe: 44 x 44 px, benachbarte Knöpfe mit mindestens 8 px Abstand
        const boxes = await page
          .getByTestId("mindmap-toolbar")
          .locator("button:visible")
          .evaluateAll((els) =>
            els.map((el) => {
              const r = el.getBoundingClientRect();
              return {
                name: el.getAttribute("aria-label") ?? el.textContent ?? "",
                group: el.closest("fieldset") ? "zoom" : "tabs",
                left: r.left,
                right: r.right,
                top: r.top,
                width: r.width,
                height: r.height
              };
            })
          );
        expect(boxes.length).toBeGreaterThanOrEqual(5);
        for (const b of boxes) {
          expect(b.width, b.name).toBeGreaterThanOrEqual(44);
          expect(b.height, b.name).toBeGreaterThanOrEqual(44);
        }
        const zoom = boxes.filter((b) => b.group === "zoom");
        for (let i = 1; i < zoom.length; i += 1) {
          const prev = zoom[i - 1];
          const cur = zoom[i];
          if (!prev || !cur || Math.abs(cur.top - prev.top) > 4) continue;
          expect(cur.left - prev.right, `${prev.name} → ${cur.name}`).toBeGreaterThanOrEqual(
            MIN_GAP
          );
        }
      });
    }
  }
}
