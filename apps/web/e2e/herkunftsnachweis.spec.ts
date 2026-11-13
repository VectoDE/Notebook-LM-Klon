import { readFile } from "node:fs/promises";
import { type Page, expect, test } from "@playwright/test";
import { findLayoutProblems } from "./helpers.js";

/**
 * Sichtbarer C2PA-Herkunftshinweis nach dem Mindmap-Export (Issue #353).
 * Der Server wird hier nachgestellt; die echte Signatur prüft der CI-Job
 * "C2PA-Herkunftsnachweis" mit c2patool (apps/worker/src/__tests__/c2pa-integration.test.ts).
 */

const SIGNED_MARKER = "<!-- c2pa: signiert im Test -->";

async function exportMindmap(page: Page) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("btn-export-mindmap-svg").click();
  const download = await downloadPromise;
  const path = await download.path();
  return { name: download.suggestedFilename(), content: await readFile(path as string, "utf8") };
}

test.describe("C2PA-Herkunftsnachweis beim Export (Issue #353)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("signiert das SVG und sagt sichtbar, dass es ein Testzertifikat ist", async ({ page }) => {
    let request: { type: string | null; url: string; body: string } | undefined;
    await page.route("**/api/v1/provenance/sign**", async (route) => {
      const req = route.request();
      request = {
        type: req.headers()["content-type"] ?? null,
        url: req.url(),
        body: req.postData() ?? ""
      };
      await route.fulfill({
        status: 200,
        headers: { "content-type": "image/svg+xml", "x-c2pa-certificate": "test" },
        body: `${req.postData() ?? ""}${SIGNED_MARKER}`
      });
    });
    await page.goto("/");
    const file = await exportMindmap(page);

    expect(file.name).toMatch(/_mindmap\.svg$/);
    expect(file.content).toContain(SIGNED_MARKER);
    expect(request?.type).toBe("image/svg+xml");
    expect(new URL(request?.url as string).searchParams.get("title")).toMatch(/– Mindmap$/);
    expect(request?.body).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(request?.body).toContain("trainedAlgorithmicMedia");

    const note = page.getByTestId("export-provenance-note");
    await expect(note).toHaveText(
      "Mit C2PA-Herkunftsnachweis signiert, Testzertifikat: Prüfwerkzeuge zeigen es als nicht vertrauenswürdig."
    );
    await expect(note).toHaveAttribute("data-signed", "true");
    // output hat die Rolle status: Screenreader sagen den Hinweis an.
    await expect(page.getByRole("status").filter({ hasText: "C2PA" })).toBeVisible();
    expect(await findLayoutProblems(page)).toEqual([]);
  });

  test("lädt ohne Zertifikat unsigniert, aber mit KI-Metadaten, und sagt das offen", async ({
    page
  }) => {
    await page.route("**/api/v1/provenance/sign**", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({ status: 503, code: "PROVENANCE_NOT_CONFIGURED" })
      })
    );
    await page.goto("/");
    const file = await exportMindmap(page);

    expect(file.content).not.toContain(SIGNED_MARKER);
    expect(file.content).toContain('xmp:CreatorTool="RelationNotes"');
    expect(file.content).toContain("trainedAlgorithmicMedia");
    const note = page.getByTestId("export-provenance-note");
    await expect(note).toContainText("Ohne C2PA-Signatur exportiert");
    await expect(note).toContainText("kein Signaturzertifikat");
    await expect(note).toHaveAttribute("data-signed", "false");
  });

  test("nennt ohne Anmeldung den Grund auf Englisch", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("rn_language", "en"));
    await page.route("**/api/v1/provenance/sign**", (route) =>
      route.fulfill({ status: 401, contentType: "application/problem+json", body: "{}" })
    );
    await page.goto("/");
    await exportMindmap(page);
    await expect(page.getByTestId("export-provenance-note")).toHaveText(
      "Exported without a C2PA signature: signing requires you to sign in."
    );
  });
});
