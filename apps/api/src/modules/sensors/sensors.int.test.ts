import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AggregateResponse, SensorHistoryResponse, SensorReading } from "@weather/contracts";
import { buildApp } from "../../app.js";
import { pool } from "../../db/client.js";
import { sensorData } from "../../db/schema.js";
import { resetTables } from "../../test-utils/test-database.js";

/**
 * The real app on a real Postgres (the `_test` database): routes, validation, SQL and mapping
 * together, with no mocks. Rows with known times are written straight into the table, requests go
 * through `app.inject` (no network, no port). Use this file as the pattern for new integration tests.
 */
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTables(pool);
});

const at = (iso: string) => new Date(iso);

async function post(source: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return app.inject({ method: "POST", url: `/v1/sensors/${source}`, payload: body, headers });
}

describe("health", () => {
  it("answers ok with the database connected", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", db: "ok" });
  });
});

describe("ingest and latest", () => {
  it("stores a firmware-style (snake_case) POST and returns it as the latest reading", async () => {
    const created = await post("room", { fused_temp: 24.5, hum: 40, bmp_press: 1013, mq5: 30, mq3: 20, pm25: 18, pm10: 30 });
    expect(created.statusCode).toBe(201);

    const latest = await app.inject({ method: "GET", url: "/v1/sensors/room/latest" });
    expect(latest.statusCode).toBe(200);
    const reading = latest.json<SensorReading>();
    expect(reading).toMatchObject({ source: "room", fusedTemp: 24.5, hum: 40, bmpPress: 1013, mq5: 30, mq3: 20, pm25: 18, pm10: 30 });
    expect(new Date(reading.recordedAt).toISOString()).toBe(reading.recordedAt);
  });

  it("stores the 0/0 dust pair a board sends on a failed read as null, not as clean air", async () => {
    await post("room", { fused_temp: 22, pm25: 0, pm10: 0 });
    const reading = (await app.inject({ method: "GET", url: "/v1/sensors/room/latest" })).json<SensorReading>();
    expect(reading.fusedTemp).toBe(22);
    expect(reading.pm25).toBeNull();
    expect(reading.pm10).toBeNull();
  });

  it("keeps dust null for a station without a dust sensor", async () => {
    await post("street", { fused_temp: 15, hum: 60 });
    const reading = (await app.inject({ method: "GET", url: "/v1/sensors/street/latest" })).json<SensorReading>();
    expect(reading.pm25).toBeNull();
    expect(reading.pm10).toBeNull();
  });

  it("returns 404 when a source has no readings yet", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/sensors/room/latest" });
    expect(res.statusCode).toBe(404);
  });

  it("rejects a wrong x-api-key, accepts the right one and still accepts none (old firmware)", async () => {
    expect((await post("room", { hum: 1 }, { "x-api-key": "wrong-key-wrong-key-wrong" })).statusCode).toBe(401);
    expect((await post("room", { hum: 2 }, { "x-api-key": "integration-test-key-0123456789" })).statusCode).toBe(201);
    expect((await post("room", { hum: 3 })).statusCode).toBe(201);
  });

  it("answers 400 to an unknown source and to a non-number value", async () => {
    expect((await post("attic", { hum: 1 })).statusCode).toBe(400);
    expect((await post("room", { hum: "wet" })).statusCode).toBe(400);
  });
});

describe("history (keyset pagination)", () => {
  it("returns every row exactly once across pages, even when many rows share one timestamp", async () => {
    const same = at("2026-10-10T10:00:00.000Z");
    await app.db.insert(sensorData).values([
      ...Array.from({ length: 12 }, () => ({ source: "room", hum: 1, recordedAt: same })),
      ...Array.from({ length: 13 }, (_, i) => ({
        source: "room",
        hum: 2,
        recordedAt: at(`2026-10-10T10:${String(i + 1).padStart(2, "0")}:00.000Z`),
      })),
    ]);

    const ids: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const suffix: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const res = await app.inject({ method: "GET", url: `/v1/sensors/room/history?limit=10${suffix}` });
      expect(res.statusCode).toBe(200);
      const page: SensorHistoryResponse = res.json();
      ids.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 10);

    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
  });

  it("returns readings oldest first", async () => {
    await app.db.insert(sensorData).values([
      { source: "room", hum: 3, recordedAt: at("2026-10-10T12:00:00.000Z") },
      { source: "room", hum: 1, recordedAt: at("2026-10-10T10:00:00.000Z") },
      { source: "room", hum: 2, recordedAt: at("2026-10-10T11:00:00.000Z") },
    ]);
    const page = (await app.inject({ method: "GET", url: "/v1/sensors/room/history" })).json<SensorHistoryResponse>();
    expect(page.items.map((r) => r.hum)).toEqual([1, 2, 3]);
  });

  it("honours from and to, and keeps the stations apart", async () => {
    await app.db.insert(sensorData).values([
      { source: "room", hum: 1, recordedAt: at("2026-10-10T10:00:00.000Z") },
      { source: "room", hum: 2, recordedAt: at("2026-10-10T11:00:00.000Z") },
      { source: "room", hum: 3, recordedAt: at("2026-10-10T12:00:00.000Z") },
      { source: "street", hum: 99, recordedAt: at("2026-10-10T11:00:00.000Z") },
    ]);
    const url = "/v1/sensors/room/history?from=2026-10-10T10:30:00.000Z&to=2026-10-10T11:30:00.000Z";
    const page = (await app.inject({ method: "GET", url })).json<SensorHistoryResponse>();
    expect(page.items.map((r) => r.hum)).toEqual([2]);
  });
});

describe("aggregate (date_bin buckets)", () => {
  it("groups readings into hourly buckets with count, avg, min and max, and leaves absent metrics null", async () => {
    await app.db.insert(sensorData).values([
      { source: "room", fusedTemp: 10, hum: 40, recordedAt: at("2026-10-10T10:05:00.000Z") },
      { source: "room", fusedTemp: 20, hum: 50, recordedAt: at("2026-10-10T10:25:00.000Z") },
      { source: "room", fusedTemp: 30, hum: 60, recordedAt: at("2026-10-10T11:10:00.000Z") },
    ]);
    const url = "/v1/sensors/room/aggregate?from=2026-10-10T10:00:00.000Z&to=2026-10-10T12:00:00.000Z&bucket=1h";
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(200);
    const body = res.json<AggregateResponse>();

    expect(body.bucket).toBe("1h");
    expect(body.items.map((b) => [b.ts, b.count])).toEqual([
      ["2026-10-10T10:00:00.000Z", 2],
      ["2026-10-10T11:00:00.000Z", 1],
    ]);
    expect(body.items[0]!.temp).toEqual({ avg: 15, min: 10, max: 20 });
    expect(body.items[0]!.hum).toEqual({ avg: 45, min: 40, max: 50 });
    expect(body.items[0]!.pm25).toEqual({ avg: null, min: null, max: null });
  });

  it("picks a bucket by itself for bucket=auto and reports which one", async () => {
    // Seven days at no more than ~1500 points: the finest bucket that fits is 15 minutes.
    const url = "/v1/sensors/room/aggregate?from=2026-10-03T00:00:00.000Z&to=2026-10-10T00:00:00.000Z";
    const body = (await app.inject({ method: "GET", url })).json<AggregateResponse>();
    expect(body.bucket).toBe("15m");
    expect(body.items).toEqual([]);
  });

  it("rejects a range whose start is not before its end", async () => {
    const url = "/v1/sensors/room/aggregate?from=2026-10-10T12:00:00.000Z&to=2026-10-10T10:00:00.000Z";
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(400);
  });
});
