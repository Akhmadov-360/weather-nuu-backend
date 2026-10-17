import { defineConfig } from "vitest/config";
import { assertSafeTestDatabase, testDatabaseUrl } from "./src/test-utils/test-database";

const url = testDatabaseUrl();
// Fail before anything starts, not after the first TRUNCATE.
assertSafeTestDatabase(url);

/**
 * Integration tests (*.int.test.ts): the real app against a real Postgres, in the `_test` database.
 * Run with `pnpm test:integration` (needs `docker compose -f docker-compose.dev.yml up -d db`).
 */
export default defineConfig({
  test: {
    include: ["src/**/*.int.test.ts"],
    exclude: ["**/node_modules/**", "dist/**"],
    globalSetup: ["./src/test-utils/global-setup.ts"],
    env: {
      DATABASE_URL: url,
      CORS_ORIGIN: "http://localhost:5173",
      INGEST_API_KEY: "integration-test-key-0123456789",
      LOG_LEVEL: "fatal",
    },
    // One shared database: files run one after another, each starts from empty tables.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
