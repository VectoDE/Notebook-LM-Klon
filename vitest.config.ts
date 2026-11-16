import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** `@/` zeigt je Paket auf dessen `src`; ein gemeinsamer Alias wäre für web und worker falsch. */
const src = (pkg: string) => fileURLToPath(new URL(`./${pkg}/src/`, import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        resolve: { alias: [{ find: /^@\//, replacement: src("apps/web") }] },
        test: {
          name: "web",
          include: [
            "apps/web/tests/{unit,integration}/**/*.test.ts",
            "apps/web/src/__tests__/**/*.test.ts"
          ]
        }
      },
      {
        extends: true,
        resolve: { alias: [{ find: /^@\//, replacement: src("apps/worker") }] },
        test: {
          name: "worker",
          include: [
            "apps/worker/tests/{unit,integration}/**/*.test.ts",
            "apps/worker/src/__tests__/**/*.test.ts"
          ]
        }
      },
      {
        extends: true,
        test: {
          name: "shared",
          include: [
            "packages/shared/tests/**/*.test.ts",
            "packages/shared/src/__tests__/**/*.test.ts"
          ]
        }
      },
      {
        extends: true,
        test: { name: "repo", include: ["tests/repo/**/*.test.ts"] }
      }
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: [
        "packages/shared/src/**/*.ts",
        "apps/worker/src/**/*.ts",
        "apps/web/src/App.tsx",
        "apps/web/src/design-tokens.ts",
        "apps/web/src/theme-preferences.ts",
        "apps/web/src/BrandLogo.tsx",
        "apps/web/src/Icon.tsx",
        "apps/web/src/focus-trap.ts",
        "apps/web/src/focus-return.ts",
        "apps/web/src/stage-visuals.ts",
        "apps/web/src/url-validation.ts",
        "apps/web/src/layout-preferences.ts",
        "apps/web/src/knowledge-graph.ts",
        "apps/web/src/entity-graph-view.ts",
        "apps/web/src/structured-demo.ts",
        "apps/web/src/view-preferences.ts",
        "apps/web/src/toast-timer.ts",
        "apps/web/src/EmptyState.tsx",
        "apps/web/src/diagram-i18n.ts",
        "apps/web/src/turnstile-client.ts",
        "apps/web/src/seo.ts",
        "apps/web/src/lazy-viewers.tsx",
        "apps/web/src/passkey-client.ts",
        "apps/web/src/comments-client.ts",
        "apps/web/src/custom-endpoint-client.ts",
        "apps/web/src/custom-endpoint-i18n.ts",
        "apps/web/src/i18n.ts",
        "apps/web/src/locale-registry.ts",
        "apps/web/src/local-crypto.ts",
        "apps/web/src/encrypted-store.ts",
        "apps/web/src/local-session.ts",
        "apps/web/src/offline-sync.ts",
        "apps/web/src/notebook-sync.ts",
        "apps/web/src/sync-status-text.ts",
        "apps/web/src/provenance-client.ts",
        "apps/web/src/chat-export.ts",
        "apps/web/src/workers/docx-parser.ts",
        "apps/web/src/local-llm-config.ts",
        "apps/web/src/local-llm.ts",
        "apps/web/src/local-llm-webllm.ts",
        "apps/web/src/offline-chat.ts",
        "apps/web/src/offline-chat-flag.ts",
        "apps/web/src/translations-offline-chat.ts",
        "apps/web/src/usage-beacon.ts",
        "apps/web/src/consent.ts",
        "apps/web/src/analytics-config.ts",
        "apps/web/src/privacy-texts.ts",
        "apps/web/src/gtm.ts"
      ],
      exclude: ["**/__tests__/**", "**/*.d.ts"],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100
      }
    }
  }
});
