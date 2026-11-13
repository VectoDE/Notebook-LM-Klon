import { createReadStream, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
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

const require = createRequire(import.meta.url);

function packageDir(name: string, from = require): string {
  return path.dirname(from.resolve(`${name}/package.json`));
}

/**
 * Texterkennung ohne fremde CDNs (Issue #153): Worker-Skript und WASM-Kern von Tesseract.js
 * sowie die Sprachdaten Deutsch und Englisch (4.0.0_best_int) kommen aus node_modules und
 * werden unter /ocr/ von der eigenen Origin ausgeliefert, im Dev-Server direkt, im Build als
 * Assets. Nur die LSTM-Kerne werden kopiert, weil die App ausschließlich OEM.LSTM_ONLY nutzt.
 */
function ocrAssetFiles(): Record<string, string> {
  const tesseractDir = packageDir("tesseract.js");
  const coreDir = packageDir(
    "tesseract.js-core",
    createRequire(path.join(tesseractDir, "package.json"))
  );
  const lang = (code: string) =>
    path.join(packageDir(`@tesseract.js-data/${code}`), "4.0.0_best_int", `${code}.traineddata.gz`);
  return {
    "ocr/worker.min.js": path.join(tesseractDir, "dist", "worker.min.js"),
    "ocr/core/tesseract-core-lstm.wasm.js": path.join(coreDir, "tesseract-core-lstm.wasm.js"),
    "ocr/core/tesseract-core-simd-lstm.wasm.js": path.join(
      coreDir,
      "tesseract-core-simd-lstm.wasm.js"
    ),
    "ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js": path.join(
      coreDir,
      "tesseract-core-relaxedsimd-lstm.wasm.js"
    ),
    "ocr/lang/deu.traineddata.gz": lang("deu"),
    "ocr/lang/eng.traineddata.gz": lang("eng")
  };
}

function ocrAssets(): Plugin {
  const files = ocrAssetFiles();
  return {
    name: "ocr-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const key = (req.url ?? "").split("?")[0]?.replace(/^\//, "") ?? "";
        const file = files[key];
        if (!file) {
          next();
          return;
        }
        res.setHeader(
          "Content-Type",
          key.endsWith(".js") ? "text/javascript; charset=utf-8" : "application/octet-stream"
        );
        createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(files)) {
        this.emitFile({ type: "asset", fileName, source: readFileSync(source) });
      }
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [
      react(),
      seoPlugin(env.VITE_PUBLIC_BASE_URL ?? process.env.VITE_PUBLIC_BASE_URL),
      ocrAssets()
    ],
    worker: {
      format: "es"
    },
    build: {
      outDir: "dist",
      sourcemap: false,
      target: "es2022"
    }
  };
});
