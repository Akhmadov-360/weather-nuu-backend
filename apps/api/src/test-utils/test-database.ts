import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, type Pool } from "pg";

/** Local Postgres from `docker compose -f docker-compose.dev.yml up -d db`, in its own database. */
export const DEFAULT_TEST_DATABASE_URL = "postgres://weather:weather@localhost:55432/weather_test";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}

export function parseDatabaseUrl(url: string): { host: string; port: number; database: string; adminUrl: string } {
  const parsed = new URL(url);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    database: parsed.pathname.replace(/^\//, ""),
    adminUrl: admin.toString().replace(/\/$/, ""),
  };
}

/**
 * Integration tests wipe their tables. This is the guard that keeps that away from anything
 * that matters: only a local server and only a database whose name ends with `_test`.
 */
export function assertSafeTestDatabase(url: string): void {
  const { host, database } = parseDatabaseUrl(url);
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to run integration tests against "${host}": only a local database is allowed.`);
  }
  if (!database.endsWith("_test")) {
    throw new Error(`Refusing to run integration tests against "${database}": the database name must end with _test.`);
  }
}

/** Creates the test database if it is missing and applies the migrations (safe to run every time). */
export async function prepareTestDatabase(url: string): Promise<void> {
  assertSafeTestDatabase(url);
  const { database, adminUrl } = parseDatabaseUrl(url);

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.end();
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: fileURLToPath(new URL("../db/migrations", import.meta.url)) });
  } finally {
    await client.end();
  }
}

/** Empties the data tables between tests (and checks once more that this really is a test database). */
export async function resetTables(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ db: string }>("SELECT current_database() AS db");
  if (!rows[0]?.db.endsWith("_test")) throw new Error(`resetTables on "${rows[0]?.db}": not a test database`);
  await pool.query("TRUNCATE TABLE sensor_data, cansat_data RESTART IDENTITY");
}
