import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/src/__tests__/**/*.test.ts", "apps/**/src/__tests__/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["packages/shared/src/**/*.ts", "apps/worker/src/**/*.ts"],
      exclude: ["**/__tests__/**", "**/*.d.ts"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90
      }
    }
  }
});
