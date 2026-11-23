import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EventsResponseSchema } from "@weather/contracts";
import { buildApp } from "../../app.js";
import { pool } from "../../db/client.js";
import { sensorData } from "../../db/schema.js";
import { resetTables } from "../../test-utils/test-database.js";
import { generateSeries } from "./synthetic.js";

/** The events endpoint on a real Postgres: the aggregation query by the minute, the detector and the contract together. */
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

const T0 = Date.parse("2026-11-22T19:00:00Z"); // 23 Nov 00:00 in Tashkent

describe("GET /v1/events", () => {
  it("answers with the shape of the contract for a day of readings of the room and the street", async () => {
    const { samples } = generateSeries({ seed: 2, days: 1 });
    const rows = samples.flatMap((s) => [
      { source: "room", hum: s.hum, fusedTemp: s.temp, pm25: Math.round(s.pm25), recordedAt: new Date(T0 + s.t * 60_000) },
      { source: "street", hum: s.outHum, fusedTemp: s.outTemp, pm25: null, recordedAt: new Date(T0 + s.t * 60_000) },
    ]);
    const { db } = await import("../../db/client.js");
    for (let i = 0; i < rows.length; i += 500) await db.insert(sensorData).values(rows.slice(i, i + 500));

    const res = await app.inject({ method: "GET", url: `/v1/events?from=${new Date(T0 + 6 * 3_600_000).toISOString()}&to=${new Date(T0 + 23 * 3_600_000).toISOString()}` });
    expect(res.statusCode).toBe(200);
    const body = EventsResponseSchema.parse(res.json());
    expect(body.coverageMinutes).toBeGreaterThan(16 * 60);
    expect(body.method.experimental).toBe(true);
  });

  it("answers with no events and no coverage when there is no data", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/events?from=2026-11-23T00:00:00Z&to=2026-11-23T06:00:00Z" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ events: [], coverageMinutes: 0 });
  });
});
