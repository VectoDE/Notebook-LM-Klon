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
        "apps/web/src/theme/design-tokens.ts",
        "apps/web/src/theme/theme-preferences.ts",
        "apps/web/src/components/ui/BrandLogo.tsx",
        "apps/web/src/components/ui/Icon.tsx",
        "apps/web/src/lib/a11y/focus-trap.ts",
        "apps/web/src/lib/a11y/focus-return.ts",
        "apps/web/src/lib/utils/stage-visuals.ts",
        "apps/web/src/lib/utils/url-validation.ts",
        "apps/web/src/preferences/layout-preferences.ts",
        "apps/web/src/lib/graph/knowledge-graph.ts",
        "apps/web/src/lib/graph/entity-graph-view.ts",
        "apps/web/src/data/structured-demo.ts",
        "apps/web/src/preferences/view-preferences.ts",
        "apps/web/src/lib/utils/toast-timer.ts",
        "apps/web/src/components/ui/EmptyState.tsx",
        "apps/web/src/i18n/catalogs/diagram-i18n.ts",
        "apps/web/src/services/api/turnstile-client.ts",
        "apps/web/src/config/seo.ts",
        "apps/web/src/components/lazy/lazy-viewers.tsx",
        "apps/web/src/services/api/passkey-client.ts",
        "apps/web/src/services/api/comments-client.ts",
        "apps/web/src/services/api/custom-endpoint-client.ts",
        "apps/web/src/i18n/catalogs/custom-endpoint-i18n.ts",
        "apps/web/src/i18n/i18n.ts",
        "apps/web/src/i18n/locale-registry.ts",
        "apps/web/src/services/storage/local-crypto.ts",
        "apps/web/src/services/storage/encrypted-store.ts",
        "apps/web/src/services/storage/local-session.ts",
        "apps/web/src/services/sync/offline-sync.ts",
        "apps/web/src/services/sync/notebook-sync.ts",
        "apps/web/src/services/sync/sync-status-text.ts",
        "apps/web/src/services/api/provenance-client.ts",
        "apps/web/src/lib/export/chat-export.ts",
        "apps/web/src/workers/docx-parser.ts",
        "apps/web/src/services/llm/local-llm-config.ts",
        "apps/web/src/services/llm/local-llm.ts",
        "apps/web/src/services/llm/local-llm-webllm.ts",
        "apps/web/src/services/llm/offline-chat.ts",
        "apps/web/src/services/llm/offline-chat-flag.ts",
        "apps/web/src/i18n/catalogs/translations-offline-chat.ts",
        "apps/web/src/services/analytics/usage-beacon.ts",
        "apps/web/src/services/analytics/consent.ts",
        "apps/web/src/config/analytics-config.ts",
        "apps/web/src/i18n/catalogs/privacy-texts.ts",
        "apps/web/src/services/analytics/gtm.ts"
      ],
      exclude: [
        "**/__tests__/**",
        "**/*.d.ts",
        // Barrels in Unterordnern enthalten nur Re-Exporte (tests/repo/import-graph.test.ts prüft das)
        "packages/shared/src/*/index.ts",
        "apps/worker/src/*/index.ts",
        "apps/worker/src/*/*/index.ts",
        "apps/web/src/**/index.ts"
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100
      }
    }
  }
});
