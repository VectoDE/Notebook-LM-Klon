import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/src/__tests__/**/*.test.ts", "apps/**/src/__tests__/**/*.test.ts"],
    environment: "node",
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
        "apps/web/src/view-preferences.ts",
        "apps/web/src/toast-timer.ts",
        "apps/web/src/EmptyState.tsx",
        "apps/web/src/turnstile-client.ts"
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
