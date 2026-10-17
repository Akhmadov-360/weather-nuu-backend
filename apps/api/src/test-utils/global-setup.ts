import { prepareTestDatabase, testDatabaseUrl } from "./test-database.js";

/** Runs once before the integration tests: the database exists and is migrated. */
export default async function setup(): Promise<void> {
  await prepareTestDatabase(testDatabaseUrl());
}
