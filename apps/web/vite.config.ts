import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig, loadEnv } from "vite";
import {
  buildHeadTags,
  buildLlmsTxt,
  buildRobotsTxt,
  buildSitemapXml,
  normalizePublicBaseUrl
} from "./src/seo";

/**
 * SEO-Dateien beim Build (Issue #263): Kopfbereich in index.html, robots.txt, llms.txt und,
 * nur mit gesetzter Basis-URL (VITE_PUBLIC_BASE_URL), sitemap.xml.
 */
function seoPlugin(rawBaseUrl: string | undefined): Plugin {
  const baseUrl = normalizePublicBaseUrl(rawBaseUrl);
  return {
    name: "relationnotes-seo",
    transformIndexHtml(html) {
      return html.replace("<!-- seo-head -->", buildHeadTags(baseUrl));
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "robots.txt", source: buildRobotsTxt(baseUrl) });
      this.emitFile({ type: "asset", fileName: "llms.txt", source: buildLlmsTxt(baseUrl) });
      if (baseUrl) {
        const epoch = Number(process.env.SOURCE_DATE_EPOCH);
        const date = Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000) : new Date();
        const lastModified = date.toISOString().slice(0, 10);
        this.emitFile({
          type: "asset",
          fileName: "sitemap.xml",
          source: buildSitemapXml(baseUrl, lastModified)
        });
      }
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react(), seoPlugin(env.VITE_PUBLIC_BASE_URL ?? process.env.VITE_PUBLIC_BASE_URL)],
    build: {
      outDir: "dist",
      sourcemap: false,
      target: "es2022"
    }
  };
});
