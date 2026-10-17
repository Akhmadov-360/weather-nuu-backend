import { defineConfig } from "vitest/config";

/** Unit tests: pure logic, no database. Integration tests (*.int.test.ts) have their own config. */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "dist/**", "src/**/*.int.test.ts"],
  },
});
