import { type Page, expect, test } from "@playwright/test";
import { DESIGNS, chooseDesign, findLayoutProblems, openPanel } from "./helpers";

async function openVideo(page: Page): Promise<void> {
  await openPanel(page, "studio");
  await page.getByTestId("btn-open-video-tool").click();
  const player = page.getByTestId("video-overview-player");
  await expect(player).toBeVisible();
  await player.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((anim) => anim.finished))
  );
}

/** Kleinste Schriftgröße aller sichtbaren Texte im Player (in CSS-Pixeln). */
async function smallestPlayerText(page: Page): Promise<number> {
  return page.getByTestId("video-overview-player").evaluate((root) => {
    let min = Number.POSITIVE_INFINITY;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !(node.textContent ?? "").trim()) continue;
      const r = parent.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      min = Math.min(min, Number.parseFloat(getComputedStyle(parent).fontSize));
    }
    return min;
  });
}

for (const width of [390, 1440]) {
  test.describe(`Video-Übersicht ${width} px`, () => {
    test.use({ viewport: { width, height: 860 } });

    test("Leinwand ist ein Bild mit Folientitel, Folientext lesbar als HTML", async ({ page }) => {
      await page.goto("/");
      await openVideo(page);
      const canvas = page.getByRole("img", { name: "Folie 1 von 2: Cloudflare Edge Stack" });
      await expect(canvas).toBeVisible();
      const description = await canvas.evaluate((el) => {
        const id = el.getAttribute("aria-describedby") ?? "";
        return document.getElementById(id)?.textContent ?? "";
      });
      expect(description).toContain("Single Worker Hono");

      const title = page
        .getByTestId("video-slide-text")
        .getByRole("heading", { name: "Cloudflare Edge Stack" });
      await expect(title).toBeVisible();
      expect(await smallestPlayerText(page)).toBeGreaterThanOrEqual(14);
      const titleSize = await title.evaluate((el) =>
        Number.parseFloat(getComputedStyle(el).fontSize)
      );
      expect(titleSize).toBeGreaterThanOrEqual(17);

      // Kein zweiter Rahmen um die Leinwand, nichts ragt heraus
      const screenShadow = await page
        .locator(".rn-video-screen")
        .evaluate((el) => getComputedStyle(el).boxShadow);
      expect(screenShadow).toBe("none");
      expect(await findLayoutProblems(page)).toEqual([]);
    });

    test("Tastenkürzel nur am Player, nicht auf Knöpfen und Regler", async ({ page }) => {
      await page.goto("/");
      await openVideo(page);
      const play = page.getByTestId("play-pause-button");
      const subtitles = page.getByTestId("toggle-subtitles-button");
      const slider = page.getByRole("slider", { name: "Wiedergabeposition" });

      // Leertaste auf einem Umschalter schaltet nur ihn, startet nicht das Video
      await subtitles.focus();
      await page.keyboard.press("Space");
      await expect(subtitles).toHaveAttribute("aria-pressed", "false");
      await expect(play).toHaveText("Abspielen");
      await page.keyboard.press("Space");
      await expect(subtitles).toHaveAttribute("aria-pressed", "true");

      // Pfeiltaste im Regler: 1 s statt 5 s, Zeit als Text
      await expect(slider).toHaveAttribute("aria-valuetext", "0:00 von 0:30");
      await expect(slider).toHaveAttribute("step", "1");
      await slider.focus();
      await page.keyboard.press("ArrowRight");
      await expect(slider).toHaveAttribute("aria-valuetext", "0:01 von 0:30");
      await expect(page.getByTestId("video-time")).toHaveText("0:01 / 0:30");
      await expect(play).toHaveText("Abspielen");

      // Kürzel am Player selbst
      await page.getByTestId("video-overview-player").focus();
      await page.keyboard.press("ArrowRight");
      await expect(slider).toHaveAttribute("aria-valuetext", "0:06 von 0:30");
      await page.keyboard.press("d");
      await expect(page.getByTestId("toggle-ad-button")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("a11y-live-region")).toContainText("Audiodeskription an");
      await page.keyboard.press("k");
      await expect(play).toHaveText("Pausieren");
      await page.keyboard.press("k");
      await expect(play).toHaveText("Abspielen");
    });

    test("Zugängliche Namen beginnen mit der sichtbaren Beschriftung", async ({ page }) => {
      await page.goto("/");
      await openVideo(page);
      const player = page.getByTestId("video-overview-player");
      const mismatches = await player.evaluate((root) =>
        Array.from(root.querySelectorAll("button"))
          .map((el) => {
            const visible = (el as HTMLElement).innerText.trim().replace(/\s+/g, " ");
            const label = el.getAttribute("aria-label");
            return { visible, label };
          })
          .filter(({ visible, label }) => label !== null && !label.startsWith(visible))
          .map(({ visible, label }) => `${visible} → ${label}`)
      );
      expect(mismatches).toEqual([]);
      await expect(page.getByRole("button", { name: "Abspielen", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Untertitel", exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Audiodeskription", exact: true })
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /^Einführung ?, Kapitel 1 von 2$/ })
      ).toBeVisible();
      const text = (await player.textContent()) ?? "";
      const labels = await player.evaluate((root) =>
        Array.from(root.querySelectorAll("[aria-label]"))
          .map((el) => el.getAttribute("aria-label"))
          .join(" ")
      );
      expect(`${text} ${labels}`).not.toMatch(/fuer|Fuer|ueber|Ueber/);
    });
  });
}

test.describe("Video-Umschalter", () => {
  test.use({ viewport: { width: 1440, height: 860 } });

  for (const design of DESIGNS) {
    test(`${design}: gedrückt = getönte Fläche mit Häkchen, anders als die Hauptaktion`, async ({
      page
    }) => {
      await page.goto("/");
      await chooseDesign(page, design, "dark");
      await openVideo(page);
      const look = (testId: string) =>
        page.getByTestId(testId).evaluate((el) => {
          const check = el.querySelector(".rn-video-toggle-check");
          return {
            background: getComputedStyle(el).backgroundColor,
            check: check ? getComputedStyle(check).visibility : "missing"
          };
        });
      const primary = await look("play-pause-button");
      const pressed = await look("toggle-subtitles-button");
      const released = await look("toggle-ad-button");
      expect(pressed.check).toBe("visible");
      expect(released.check).toBe("hidden");
      expect(pressed.background).not.toBe(primary.background);
      expect(pressed.background).not.toBe(released.background);
      expect(released.background).toBe("rgba(0, 0, 0, 0)");
    });
  }
});
