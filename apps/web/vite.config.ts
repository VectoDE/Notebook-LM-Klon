import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig, loadEnv } from "vite";
import { injectSiteVerification } from "./src/analytics-config.ts";

/** Search-Console-Bestätigung nur per Umgebungsvariable (Issue #260). */
function siteVerification(token: string | undefined): Plugin {
  return {
    name: "rn-site-verification",
    transformIndexHtml: (html) => injectSiteVerification(html, token)
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react(), siteVerification(env.VITE_GSC_VERIFICATION)],
    build: {
      outDir: "dist",
      sourcemap: false,
      target: "es2022"
    }
  };
});
