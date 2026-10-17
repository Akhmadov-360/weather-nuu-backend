import { describe, expect, it } from "vitest";
import { assertSafeTestDatabase, DEFAULT_TEST_DATABASE_URL, parseDatabaseUrl } from "./test-database.js";

describe("parseDatabaseUrl", () => {
  it("splits a connection string into host, port, database and the admin database to connect to first", () => {
    expect(parseDatabaseUrl("postgres://u:p@localhost:55432/weather_test")).toEqual({
      host: "localhost",
      port: 55432,
      database: "weather_test",
      adminUrl: "postgres://u:p@localhost:55432/postgres",
    });
  });

  it("uses the default Postgres port when none is given", () => {
    expect(parseDatabaseUrl("postgres://u:p@127.0.0.1/weather_test").port).toBe(5432);
  });
});

describe("assertSafeTestDatabase", () => {
  it.each([
    "postgres://weather:weather@localhost:55432/weather_test",
    "postgres://weather:weather@127.0.0.1:5432/weather_test",
    "postgres://weather:weather@[::1]:5432/other_test",
  ])("accepts %s", (url) => {
    expect(() => assertSafeTestDatabase(url)).not.toThrow();
  });

  it("refuses a database whose name does not end with _test (the development or production database)", () => {
    expect(() => assertSafeTestDatabase("postgres://weather:weather@localhost:55432/weather")).toThrow(/_test/);
  });

  it.each(["postgres://u:p@weather-db:5432/weather_test", "postgres://u:p@weather.nuu.uz:5432/weather_test", "postgres://u:p@10.0.0.5:5432/x_test"])(
    "refuses the remote host in %s",
    (url) => {
      expect(() => assertSafeTestDatabase(url)).toThrow(/local/);
    },
  );

  it("refuses something that is not a connection string", () => {
    expect(() => assertSafeTestDatabase("not a url")).toThrow();
  });

  it("the default test database is itself safe", () => {
    expect(() => assertSafeTestDatabase(DEFAULT_TEST_DATABASE_URL)).not.toThrow();
  });
});
