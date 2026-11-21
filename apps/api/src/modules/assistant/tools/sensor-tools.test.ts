import { describe, expect, it } from "vitest";
import { AppError, type AggregateBucketRow, type SensorReading, type SensorSource } from "@weather/contracts";
import { ToolRegistry } from "./registry.js";
import { createSensorTools, MAX_RANGE_DAYS, type SensorToolDeps } from "./sensor-tools.js";

const NOW = new Date("2026-11-21T10:00:00Z");
const ctx = { now: NOW };

function reading(source: SensorSource, over: Partial<SensorReading> = {}): SensorReading {
  return {
    id: 1,
    source,
    hum: 38.1,
    bmpPress: 962.6,
    mq5: 17,
    mq3: 1,
    fusedTemp: 24.7,
    pm25: source === "room" ? 147.4 : null,
    pm10: source === "room" ? 160 : null,
    recordedAt: "2026-11-21T09:59:30.000Z",
    ...over,
  };
}

const stat = (avg: number | null, min = avg, max = avg) => ({ avg, min, max });
const empty = stat(null);

function bucket(ts: string, count: number, over: Partial<AggregateBucketRow> = {}): AggregateBucketRow {
  return { ts, count, hum: empty, press: empty, mq5: empty, mq3: empty, temp: empty, pm25: empty, pm10: empty, ...over };
}

function makeRegistry(overrides: Partial<SensorToolDeps> = {}) {
  const deps: SensorToolDeps = {
    latest: async (source) => reading(source),
    aggregate: async () => [],
    ...overrides,
  };
  return new ToolRegistry(createSensorTools(deps));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (content: string) => JSON.parse(content) as Record<string, any>;

describe("get_current", () => {
  it("returns the latest values with the AQI category for dust", async () => {
    const result = await makeRegistry().run("get_current", { source: "room" }, ctx);
    expect(result.ok).toBe(true);
    const data = parse(result.content);
    expect(data.temperatureC).toBe(24.7);
    expect(data.humidityPercent).toBe(38.1);
    expect(data.pm25.value).toBe(147.4);
    expect(data.pm25.category).toBe("very_unhealthy");
    expect(typeof data.pm25.aqi).toBe("number");
    expect(data.ageSeconds).toBe(30);
  });

  it("says the street has no dust sensor instead of inventing a value", async () => {
    const data = parse((await makeRegistry().run("get_current", { source: "street" }, ctx)).content);
    expect(data.pm25).toBeNull();
    expect(data.notes.join(" ")).toMatch(/no dust sensor/i);
  });

  it("marks old data as stale", async () => {
    const old = reading("room", { recordedAt: "2026-11-21T09:00:00.000Z" });
    const data = parse((await makeRegistry({ latest: async () => old }).run("get_current", { source: "room" }, ctx)).content);
    expect(data.stale).toBe(true);
  });

  it("tells the model when there is no reading yet", async () => {
    const registry = makeRegistry({
      latest: async () => {
        throw AppError.notFound('No readings for source "room" yet');
      },
    });
    const result = await registry.run("get_current", { source: "room" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/no readings/i);
  });

  it("rejects a source that does not exist", async () => {
    expect((await makeRegistry().run("get_current", { source: "garden" }, ctx)).ok).toBe(false);
  });
});

describe("get_period_summary", () => {
  const from = "2026-11-21T04:00:00Z";
  const to = "2026-11-21T10:00:00Z";

  it("summarises a period: weighted mean, lowest, highest, trend", async () => {
    const buckets = [
      bucket("2026-11-21T04:00:00Z", 100, { temp: stat(20, 19, 21) }),
      bucket("2026-11-21T07:00:00Z", 300, { temp: stat(24, 22, 26) }),
      bucket("2026-11-21T09:00:00Z", 100, { temp: stat(28, 27, 30) }),
    ];
    const registry = makeRegistry({ aggregate: async () => buckets });
    const result = await registry.run("get_period_summary", { source: "room", from, to, metrics: ["temperature"] }, ctx);
    expect(result.ok).toBe(true);
    const t = parse(result.content).metrics.temperature;
    expect(t.avg).toBeCloseTo((20 * 100 + 24 * 300 + 28 * 100) / 500, 1);
    expect(t.min).toBe(19);
    expect(t.max).toBe(30);
    expect(t.trend).toBe("rising");
    expect(t.readings).toBe(500);
  });

  it("calls a flat series steady", async () => {
    const buckets = [0, 1, 2, 3].map((i) => bucket(`2026-11-21T0${4 + i}:00:00Z`, 60, { hum: stat(40, 39.9, 40.1) }));
    const result = await makeRegistry({ aggregate: async () => buckets }).run("get_period_summary", { source: "room", from, to, metrics: ["humidity"] }, ctx);
    expect(parse(result.content).metrics.humidity.trend).toBe("steady");
  });

  it("calls a falling series falling", async () => {
    const buckets = [30, 28, 26, 24].map((v, i) => bucket(`2026-11-21T0${4 + i}:00:00Z`, 60, { temp: stat(v) }));
    const result = await makeRegistry({ aggregate: async () => buckets }).run("get_period_summary", { source: "room", from, to, metrics: ["temperature"] }, ctx);
    expect(parse(result.content).metrics.temperature.trend).toBe("falling");
  });

  it("adds the AQI category for the mean dust level", async () => {
    const buckets = [bucket("2026-11-21T04:00:00Z", 60, { pm25: stat(147.4, 100, 200) })];
    const result = await makeRegistry({ aggregate: async () => buckets }).run("get_period_summary", { source: "room", from, to, metrics: ["pm25"] }, ctx);
    expect(parse(result.content).metrics.pm25.category).toBe("very_unhealthy");
  });

  it("says there is no data for a metric that was never measured", async () => {
    const buckets = [bucket("2026-11-21T04:00:00Z", 60, { temp: stat(20) })];
    const result = await makeRegistry({ aggregate: async () => buckets }).run("get_period_summary", { source: "street", from, to, metrics: ["pm25"] }, ctx);
    expect(parse(result.content).metrics.pm25).toEqual({ available: false, note: expect.stringMatching(/no data/i) });
  });

  it("says there is no data for an empty period", async () => {
    const result = await makeRegistry().run("get_period_summary", { source: "room", from, to, metrics: ["temperature"] }, ctx);
    expect(result.ok).toBe(true);
    expect(parse(result.content).readings).toBe(0);
  });

  it(`refuses a period longer than ${MAX_RANGE_DAYS} days and says so`, async () => {
    const result = await makeRegistry().run("get_period_summary", { source: "room", from: "2026-09-01T00:00:00Z", to: "2026-11-21T00:00:00Z", metrics: ["temperature"] }, ctx);
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(new RegExp(String(MAX_RANGE_DAYS)));
  });

  it("refuses a period that ends before it starts", async () => {
    const result = await makeRegistry().run("get_period_summary", { source: "room", from: to, to: from, metrics: ["temperature"] }, ctx);
    expect(result.ok).toBe(false);
  });

  it("refuses an empty list of metrics and an unknown metric", async () => {
    expect((await makeRegistry().run("get_period_summary", { source: "room", from, to, metrics: [] }, ctx)).ok).toBe(false);
    expect((await makeRegistry().run("get_period_summary", { source: "room", from, to, metrics: ["co2"] }, ctx)).ok).toBe(false);
  });
});

describe("compare_room_street", () => {
  const from = "2026-11-21T04:00:00Z";
  const to = "2026-11-21T10:00:00Z";

  it("gives both means and the difference", async () => {
    const registry = makeRegistry({
      aggregate: async ({ source }) => [bucket("2026-11-21T04:00:00Z", 60, { temp: source === "room" ? stat(24) : stat(10) })],
    });
    const data = parse((await registry.run("compare_room_street", { metric: "temperature", from, to }, ctx)).content);
    expect(data.room.avg).toBe(24);
    expect(data.street.avg).toBe(10);
    expect(data.differenceRoomMinusStreet).toBe(14);
  });

  it("explains that dust cannot be compared because the street has no sensor", async () => {
    const result = await makeRegistry().run("compare_room_street", { metric: "pm25", from, to }, ctx);
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/no dust sensor/i);
  });
});
