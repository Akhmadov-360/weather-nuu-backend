import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { describe, expect, it, vi } from "vitest";
import { EventsResponseSchema, type AggregateBucketRow } from "@weather/contracts";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { createEventsTool } from "../assistant/tools/events-tool.js";
import { detectEvents } from "./detect.js";
import { EventsService, eventsFromRows, type Schedule } from "./events.service.js";
import { parseSchedule, parseTimes } from "./schedule.js";
import { generateSeries, type Sample } from "./synthetic.js";

const OFFSET = 300; // Tashkent
const DAY_ZERO = Date.parse("2026-11-22T19:00:00Z"); // 23 Nov 00:00 in Tashkent
const SCHEDULE: Schedule = { lessonStarts: [13 * 60 + 30], lessonEnds: [17 * 60 + 50] };

const stats = (v: number | null) => ({ avg: v, min: v, max: v });
function row(minuteFromZero: number, over: Partial<AggregateBucketRow>): AggregateBucketRow {
  return {
    ts: new Date(DAY_ZERO + minuteFromZero * 60_000).toISOString(),
    count: 6,
    hum: stats(null),
    press: stats(null),
    mq5: stats(null),
    mq3: stats(null),
    temp: stats(null),
    pm25: stats(null),
    pm10: stats(null),
    ...over,
  };
}

function roomRows(samples: Sample[], keep: (t: number) => boolean = () => true): AggregateBucketRow[] {
  return samples.filter((s) => keep(s.t)).map((s) => row(s.t, { temp: stats(s.temp), hum: stats(s.hum), pm25: stats(s.pm25) }));
}
const streetRows = (samples: Sample[]) => samples.map((s) => row(s.t, { temp: stats(s.outTemp), hum: stats(s.outHum) }));

describe("eventsFromRows on a synthetic series placed in real dates", () => {
  const { samples, truth } = generateSeries({ seed: 2, days: 2 });
  const from = new Date(DAY_ZERO + 12 * 60 * 60_000); // 12:00 of the first day
  const to = new Date(DAY_ZERO + 24 * 60 * 60_000); // midnight

  const result = eventsFromRows({ room: roomRows(samples), street: streetRows(samples), from, to, schedule: SCHEDULE, utcOffsetMin: OFFSET });

  it("answers in the shape of the contract", () => {
    expect(EventsResponseSchema.safeParse(result).success).toBe(true);
    expect(result.method).toMatchObject({ name: "cusum-rules-v1", experimental: true });
    expect(result.method.classes).toEqual(["ventilation", "cleaning", "ac", "class_start", "class_end"]);
  });

  it("tells what the detector tells on the same series, at the real dates (the conversion loses nothing)", () => {
    const direct = detectEvents(samples, SCHEDULE).filter((e) => e.startMin >= 12 * 60 && e.startMin <= 24 * 60);
    expect(direct.length).toBeGreaterThan(1);
    expect(result.events.map((e) => e.cls)).toEqual(direct.map((e) => e.cls));
    result.events.forEach((e, i) => expect(Date.parse(e.start)).toBe(DAY_ZERO + direct[i]!.startMin * 60_000));
  });

  it("finds some of the events that were put in, near their real dates", () => {
    const real = truth.filter((e) => e.startMin >= 12 * 60 && e.startMin <= 24 * 60);
    const hit = real.filter((e) => result.events.some((x) => x.cls === e.cls && Math.abs(Date.parse(x.start) - (DAY_ZERO + e.startMin * 60_000)) <= 30 * 60_000));
    expect(hit.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps events inside the period, oldest first, and never reports a start after the detection", () => {
    for (const e of result.events) {
      expect(Date.parse(e.start)).toBeGreaterThanOrEqual(from.getTime());
      expect(Date.parse(e.start)).toBeLessThanOrEqual(to.getTime());
      expect(Date.parse(e.detected)).toBeGreaterThanOrEqual(Date.parse(e.start));
    }
    expect([...result.events].sort((a, b) => a.start.localeCompare(b.start))).toEqual(result.events);
  });

  it("counts the minutes of the period that have readings", () => {
    expect(result.coverageMinutes).toBeGreaterThanOrEqual(12 * 60 - 1);
    expect(result.coverageMinutes).toBeLessThanOrEqual(12 * 60 + 1);
  });

  it("confirms a ventilation by the street only when the air of the room really came closer to it", () => {
    const vent = result.events.filter((e) => e.cls === "ventilation");
    for (const e of result.events.filter((x) => x.cls !== "ventilation")) expect(e.confirmedByStreet).toBeNull();
    if (vent.length) expect(vent.some((e) => e.confirmedByStreet === true)).toBe(true);
  });

  it("does not tell the lessons without a schedule", () => {
    const none = eventsFromRows({ room: roomRows(samples), street: streetRows(samples), from, to, schedule: { lessonStarts: [], lessonEnds: [] }, utcOffsetMin: OFFSET });
    expect(none.events.some((e) => e.cls === "class_start" || e.cls === "class_end")).toBe(false);
    expect(none.method.classes).toEqual(["ventilation", "cleaning", "ac"]);
  });
});

describe("holes and missing data", () => {
  const { samples } = generateSeries({ seed: 3, days: 1 });
  const from = new Date(DAY_ZERO + 6 * 60 * 60_000);
  const to = new Date(DAY_ZERO + 23 * 60 * 60_000);

  it("gives no events and no failure when there is no dust reading at all", () => {
    const noDust = samples.map((s) => row(s.t, { temp: stats(s.temp), hum: stats(s.hum) }));
    const r = eventsFromRows({ room: noDust, street: [], from, to, schedule: SCHEDULE, utcOffsetMin: OFFSET });
    expect(r.events).toEqual([]);
    expect(r.coverageMinutes).toBe(0);
  });

  it("does not bridge a long hole: nothing is reported inside it and the coverage shows it", () => {
    const hole = (t: number) => !(t >= 14 * 60 && t < 16 * 60);
    const r = eventsFromRows({ room: roomRows(samples, hole), street: streetRows(samples), from, to, schedule: SCHEDULE, utcOffsetMin: OFFSET });
    for (const e of r.events) {
      const minute = (Date.parse(e.start) - DAY_ZERO) / 60_000;
      expect(minute < 14 * 60 || minute >= 16 * 60, `event at minute ${minute}`).toBe(true);
    }
    expect(r.coverageMinutes).toBeLessThan(17 * 60 - 110);
  });

  it("copes with a short series and with no rows at all", () => {
    expect(eventsFromRows({ room: roomRows(samples.slice(0, 60)), street: [], from, to, schedule: SCHEDULE, utcOffsetMin: OFFSET }).events).toEqual([]);
    expect(eventsFromRows({ room: [], street: [], from, to, schedule: SCHEDULE, utcOffsetMin: OFFSET }).coverageMinutes).toBe(0);
  });

  it("fills a gap of a few minutes (a lost packet) instead of splitting the series", () => {
    const small = (t: number) => !(t >= 600 && t < 603);
    const r = eventsFromRows({ room: roomRows(samples, small), street: streetRows(samples), from, to, schedule: SCHEDULE, utcOffsetMin: OFFSET });
    const whole = eventsFromRows({ room: roomRows(samples), street: streetRows(samples), from, to, schedule: SCHEDULE, utcOffsetMin: OFFSET });
    expect(r.events.length).toBeGreaterThanOrEqual(Math.floor(whole.events.length * 0.7));
  });
});

describe("EventsService", () => {
  it("asks for the period with a margin before it, for the room and for the street, and keeps the answer for a minute", async () => {
    const { samples } = generateSeries({ seed: 2, days: 1 });
    const aggregate = vi.fn(async ({ source }: { source: "room" | "street"; from: Date; to: Date }) => (source === "room" ? roomRows(samples) : streetRows(samples)));
    let now = 1_000_000;
    const service = new EventsService({ aggregate }, { schedule: SCHEDULE, utcOffsetMin: OFFSET, now: () => now });
    const from = new Date(DAY_ZERO + 12 * 3_600_000);
    const to = new Date(DAY_ZERO + 20 * 3_600_000);
    await service.list(from, to);
    expect(aggregate).toHaveBeenCalledTimes(2);
    expect(aggregate.mock.calls[0]![0].from.getTime()).toBe(from.getTime() - 90 * 60_000);
    await service.list(from, to);
    expect(aggregate).toHaveBeenCalledTimes(2);
    now += 61_000;
    await service.list(from, to);
    expect(aggregate).toHaveBeenCalledTimes(4);
  });
});

describe("schedule settings", () => {
  it("reads times and refuses what is not a time", () => {
    expect(parseTimes("13:30, 15:10")).toEqual([810, 910]);
    expect(parseTimes(undefined)).toEqual([]);
    expect(parseTimes("  ")).toEqual([]);
    expect(() => parseTimes("25:00")).toThrow(/not a time/);
    expect(() => parseTimes("1330")).toThrow(/not a time/);
    expect(parseSchedule("9:00", "10:20")).toEqual({ lessonStarts: [540], lessonEnds: [620] });
  });
});

describe("GET /v1/events", () => {
  async function build() {
    const { createEventsRoutes } = await import("./events.routes.js");
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(errorHandlerPlugin);
    await app.register(createEventsRoutes({ list: async (from, to) => ({ from: from.toISOString(), to: to.toISOString(), events: [], method: { name: "cusum-rules-v1", experimental: true, classes: ["ventilation", "cleaning", "ac"] }, coverageMinutes: 0 }) }));
    return app;
  }

  it("refuses a period that is wrong or longer than a week with the common error shape", async () => {
    const app = await build();
    const over = await app.inject({ method: "GET", url: "/v1/events?from=2026-11-01T00:00:00Z&to=2026-11-20T00:00:00Z" });
    expect(over.statusCode).toBe(400);
    const back = await app.inject({ method: "GET", url: "/v1/events?from=2026-11-02T00:00:00Z&to=2026-11-01T00:00:00Z" });
    expect(back.statusCode).toBe(400);
    const missing = await app.inject({ method: "GET", url: "/v1/events" });
    expect(missing.statusCode).toBe(400);
    await app.close();
  });

  it("answers a good period with the answer of the service in the shape of the contract", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/v1/events?from=2026-11-23T00:00:00Z&to=2026-11-23T06:00:00Z" });
    expect(res.statusCode).toBe(200);
    expect(EventsResponseSchema.safeParse(res.json()).success).toBe(true);
    expect(res.json().from).toBe("2026-11-23T00:00:00.000Z");
    await app.close();
  });
});

describe("the tool get_events", () => {
  const response = {
    from: "2026-11-23T08:00:00.000Z",
    to: "2026-11-23T14:00:00.000Z",
    events: [{ cls: "ventilation" as const, start: "2026-11-23T09:26:00.000Z", detected: "2026-11-23T09:27:00.000Z", confirmedByStreet: true }],
    method: { name: "cusum-rules-v1" as const, experimental: true, classes: ["ventilation" as const, "cleaning" as const, "ac" as const] },
    coverageMinutes: 340,
  };
  const ctx = { now: new Date("2026-11-23T14:00:00Z") };

  it("returns the events briefly and reminds that the system found them", async () => {
    const tool = createEventsTool(async () => response);
    const result = await tool.run({ from: response.from, to: response.to }, ctx);
    expect(result.ok).toBe(true);
    const body = JSON.parse(result.content);
    expect(body.count).toBe(1);
    expect(body.events[0]).toEqual({ type: "ventilation", start: "2026-11-23T09:26:00.000Z", startLocalTime: "14:26", confirmedByStreetAir: true });
    expect(body.note).toMatch(/startLocalTime/);
    expect(body.note).toMatch(/system detected/);
    expect(body.note).toMatch(/synthetic/);
  });

  it("refuses a period that is backwards or longer than a week, and a bad date", async () => {
    const tool = createEventsTool(async () => response);
    expect((await tool.run({ from: response.to, to: response.from }, ctx)).ok).toBe(false);
    const long = await tool.run({ from: "2026-11-01T00:00:00Z", to: "2026-11-20T00:00:00Z" }, ctx);
    expect(long.ok).toBe(false);
    expect(long.content).toMatch(/longer than 7 days/);
    expect((await tool.run({ from: "yesterday", to: "today" }, ctx)).ok).toBe(false);
  });
});
