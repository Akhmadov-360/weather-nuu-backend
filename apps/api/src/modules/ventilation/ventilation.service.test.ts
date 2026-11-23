import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { describe, expect, it, vi } from "vitest";
import { VentilationAdviceSchema, type AggregateBucketRow, type VentilationAdvice } from "@weather/contracts";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { createVentilationTool } from "../assistant/tools/ventilation-tool.js";
import { generateSeries } from "../events/synthetic.js";
import { OpenMeteoOutdoor, parseOpenMeteo, type OutdoorDust, type OutdoorDustSource } from "./outdoor.js";
import { createVentilationRoutes } from "./ventilation.routes.js";
import { VentilationService } from "./ventilation.service.js";

const NOW = new Date("2026-11-23T10:05:00Z");
const MIN = 60_000;
const stats = (v: number | null) => ({ avg: v, min: v, max: v });
const row = (at: Date, over: Partial<AggregateBucketRow>): AggregateBucketRow => ({
  ts: at.toISOString(),
  count: 6,
  hum: stats(null),
  press: stats(null),
  mq5: stats(null),
  mq3: stats(null),
  temp: stats(null),
  pm25: stats(null),
  pm10: stats(null),
  ...over,
});
const lastMinutes = (n: number, over: Partial<AggregateBucketRow>, end = NOW) => Array.from({ length: n }, (_, i) => row(new Date(end.getTime() - (n - i) * MIN), over));

const outdoor = (pm25: number | null, forecast: { hours: number; value: number }[] = []): OutdoorDustSource => ({
  get: async (): Promise<OutdoorDust | null> => (pm25 === null ? null : { current: { pm25, at: new Date("2026-11-23T10:00:00Z") }, forecast, fetchedAt: NOW }),
});

function service(over: { room?: AggregateBucketRow[]; street?: AggregateBucketRow[]; outdoor?: OutdoorDustSource; now?: () => Date } = {}) {
  const aggregate = vi.fn(async ({ source }: { source: "room" | "street" }) => (source === "room" ? (over.room ?? lastMinutes(6, { pm25: stats(48), temp: stats(24) })) : (over.street ?? lastMinutes(6, { temp: stats(9.3) }))));
  const s = new VentilationService({ aggregate, outdoor: over.outdoor ?? outdoor(14.1) }, { schedule: { lessonStarts: [], lessonEnds: [] }, utcOffsetMin: 300, now: over.now ?? (() => NOW) });
  return { s, aggregate };
}

describe("the answer of Open-Meteo", () => {
  const answer = {
    current: { time: "2026-11-23T10:00", pm2_5: 14.1 },
    hourly: { time: ["2026-11-23T10:00", "2026-11-23T11:00", "2026-11-23T12:00", "2026-11-23T23:00", "2026-11-24T14:00"], pm2_5: [14.1, 18.9, null, 20, 30] },
  };

  it("takes the value now in UTC and the next hours, with the hours ahead, leaving out the past, the holes and what is too far", () => {
    const r = parseOpenMeteo(answer, NOW)!;
    expect(r.current.pm25).toBe(14.1);
    expect(r.current.at.toISOString()).toBe("2026-11-23T10:00:00.000Z");
    expect(r.forecast).toEqual([{ hours: 0.9, value: 18.9 }]);
    expect(parseOpenMeteo({ current: { time: "2026-11-23T10:00", pm2_5: null } }, NOW)).toBeNull();
    expect(parseOpenMeteo({}, NOW)).toBeNull();
    expect(parseOpenMeteo({ current: { time: "2026-11-23T10:00", pm2_5: -3 } }, NOW)).toBeNull();
  });
});

describe("OpenMeteoOutdoor", () => {
  const okBody = { current: { time: "2026-11-23T10:00", pm2_5: 14.1 }, hourly: { time: ["2026-11-23T11:00"], pm2_5: [18.9] } };
  const make = (impl: (input?: unknown) => Promise<Response>, now: () => Date) => {
    const fetcher = vi.fn(impl);
    return { source: new OpenMeteoOutdoor({ lat: 41.343, lon: 69.205, fetch: fetcher as unknown as typeof fetch, now, ttlMs: 30 * MIN }), fetcher };
  };

  it("asks for the point of the station once and keeps the answer for the time to live", async () => {
    let t = NOW.getTime();
    const { source, fetcher } = make(async () => new Response(JSON.stringify(okBody), { status: 200 }), () => new Date(t));
    await source.get();
    await source.get();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = String(fetcher.mock.calls[0]![0]);
    expect(url).toContain("latitude=41.343");
    expect(url).toContain("longitude=69.205");
    expect(url).toContain("current=pm2_5");
    t += 31 * MIN;
    await source.get();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("makes many requests at once into one", async () => {
    const { source, fetcher } = make(async () => new Response(JSON.stringify(okBody), { status: 200 }), () => NOW);
    await Promise.all([source.get(), source.get(), source.get()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("uses the last answer for a few hours when the service fails, and nothing after that", async () => {
    let t = NOW.getTime();
    let fail = false;
    const { source } = make(async () => (fail ? new Response("down", { status: 500 }) : new Response(JSON.stringify(okBody), { status: 200 })), () => new Date(t));
    expect((await source.get())?.current.pm25).toBe(14.1);
    fail = true;
    t += 2 * 3_600_000;
    expect((await source.get())?.current.pm25).toBe(14.1);
    t += 2 * 3_600_000;
    expect(await source.get()).toBeNull();
  });

  it("gives nothing on a network error or an answer that is not what was expected", async () => {
    expect(await make(async () => { throw new TypeError("fetch failed"); }, () => NOW).source.get()).toBeNull();
    expect(await make(async () => new Response("<html>", { status: 200 }), () => NOW).source.get()).toBeNull();
    expect(await make(async () => new Response(JSON.stringify({ error: true }), { status: 200 }), () => NOW).source.get()).toBeNull();
  });
});

describe("VentilationService", () => {
  it("says open when the street (by the model) is clean and the room is not, and gives the numbers in the contract shape", async () => {
    const a = await service().s.advice();
    expect(VentilationAdviceSchema.safeParse(a).success).toBe(true);
    expect(a.verdict).toBe("open");
    expect(a.inside!.pm25).toBe(48);
    expect(a.outside).toMatchObject({ pm25: 14.1, kind: "model", source: "CAMS ENSEMBLE via Open-Meteo", attributionUrl: "https://open-meteo.com/" });
    expect(a.outsideTemp).toBe(9.3);
    expect(a.predicted).toBeLessThan(48);
    expect(a.gain).toBeGreaterThan(0);
  });

  it("uses the literature value and says so when the readings have no ventilations, and does not call it verified", async () => {
    const a = await service().s.advice();
    expect(a.lambda).toMatchObject({ source: "prior", verified: false, range: null });
  });

  it("says that it does not know when there is no dust outside, and keeps what it knows about the room", async () => {
    const a = await service({ outdoor: outdoor(null) }).s.advice();
    expect(a).toMatchObject({ verdict: "unknown", reason: "no_outdoor_data", outside: null, predicted: null });
    expect(a.inside!.pm25).toBe(48);
  });

  it("says that it does not know when the room kit is silent or its last reading is old", async () => {
    const silent = await service({ room: [] }).s.advice();
    expect(silent).toMatchObject({ verdict: "unknown", reason: "no_indoor_data", inside: null });
    const old = await service({ room: lastMinutes(6, { pm25: stats(48) }, new Date(NOW.getTime() - 30 * MIN)) }).s.advice();
    expect(old.reason).toBe("no_indoor_data");
  });

  it("does not use a temperature of the street that is old, and does not stop for a silent street kit", async () => {
    const a = await service({ street: [] }).s.advice();
    expect(a.outsideTemp).toBeNull();
    expect(a.verdict).toBe("open");
  });

  it("does not advise a window in a frost", async () => {
    const a = await service({ street: lastMinutes(6, { temp: stats(-15) }) }).s.advice();
    expect(a).toMatchObject({ verdict: "dont_open", reason: "comfort" });
  });

  it("repeats the answer for a minute and asks the sensors again after that, and holds a calm change for ten minutes", async () => {
    let t = NOW.getTime();
    let room = lastMinutes(6, { pm25: stats(60) });
    const aggregate = vi.fn(async ({ source }: { source: "room" | "street" }) => (source === "room" ? room : lastMinutes(6, { temp: stats(9) })));
    const s = new VentilationService({ aggregate, outdoor: outdoor(5) }, { schedule: { lessonStarts: [], lessonEnds: [] }, utcOffsetMin: 300, now: () => new Date(t) });
    expect((await s.advice()).verdict).toBe("open");
    const calls = aggregate.mock.calls.length;
    await s.advice();
    expect(aggregate.mock.calls.length).toBe(calls);
    // The air inside becomes good: a calm change, held for ten minutes.
    t += 2 * MIN;
    room = lastMinutes(6, { pm25: stats(8) }, new Date(t));
    expect((await s.advice()).verdict).toBe("open");
    t += 10 * MIN;
    room = lastMinutes(6, { pm25: stats(8) }, new Date(t));
    expect((await s.advice()).verdict).toBe("not_needed");
  });

  it("measures the speed of air exchange here when the readings of the last days contain ventilations", async () => {
    const { samples } = generateSeries({ seed: 4, days: 10 });
    // The series starts at local midnight (19:00 UTC the day before), as the detector expects.
    const start = Date.parse("2026-11-12T19:00:00Z");
    const end = new Date(start + 10 * 1440 * MIN);
    const rows = (source: "room" | "street") =>
      samples.map((x) => row(new Date(start + x.t * MIN), source === "room" ? { temp: stats(x.temp), hum: stats(x.hum), pm25: stats(x.pm25) } : { temp: stats(x.outTemp), hum: stats(x.outHum) }));
    const aggregate = vi.fn(async ({ source }: { source: "room" | "street"; from: Date; to: Date }) => rows(source));
    const s = new VentilationService({ aggregate, outdoor: outdoor(14) }, { schedule: { lessonStarts: [810], lessonEnds: [1070] }, utcOffsetMin: 300, now: () => end });
    const lambda = await s.lambdaOpen();
    expect(lambda.source).toBe("data");
    expect(lambda.verified).toBe(true);
    expect(lambda.value).toBeGreaterThan(4);
    expect(lambda.value).toBeLessThan(15);
    expect(lambda.range).not.toBeNull();
  });

  it("falls back to the literature value when the estimation fails, and does not fail the advice", async () => {
    const aggregate = vi.fn(async ({ source, from }: { source: "room" | "street"; from: Date; to: Date }) => {
      if (NOW.getTime() - from.getTime() > 3 * 3_600_000) throw new Error("db slow");
      return source === "room" ? lastMinutes(6, { pm25: stats(48) }) : lastMinutes(6, { temp: stats(9) });
    });
    const s = new VentilationService({ aggregate, outdoor: outdoor(14) }, { schedule: { lessonStarts: [], lessonEnds: [] }, utcOffsetMin: 300, now: () => NOW });
    const a = await s.advice();
    expect(a.lambda.source).toBe("prior");
    expect(a.verdict).toBe("open");
  });
});

describe("GET /v1/ventilation/advice", () => {
  it("answers with the advice of the service in the shape of the contract", async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(errorHandlerPlugin);
    await app.register(createVentilationRoutes(service().s));
    const res = await app.inject({ method: "GET", url: "/v1/ventilation/advice" });
    expect(res.statusCode).toBe(200);
    expect(VentilationAdviceSchema.safeParse(res.json()).success).toBe(true);
    expect(res.json().outside.kind).toBe("model");
    await app.close();
  });
});

describe("the tool get_ventilation_advice", () => {
  const ctx = { now: NOW };
  const base: VentilationAdvice = {
    verdict: "open",
    reason: "outside_cleaner",
    computedAt: NOW.toISOString(),
    inside: { pm25: 48, at: NOW.toISOString() },
    outside: { pm25: 14.1, at: NOW.toISOString(), kind: "model", source: "CAMS ENSEMBLE via Open-Meteo", attributionUrl: "https://open-meteo.com/" },
    outsideTemp: 9.3,
    horizonMinutes: 15,
    predicted: 17.6,
    predictedRange: [15, 24],
    gain: 30.4,
    waitHours: null,
    lambda: { value: 5, source: "prior", verified: false, range: null },
    forecast: [{ hours: 1, value: 18.9 }],
  };

  it("hands over the verdict and reminds the model that the outside dust is a model and the speed a literature value", async () => {
    const r = await createVentilationTool(async () => base).run({}, ctx);
    expect(r.ok).toBe(true);
    const body = JSON.parse(r.content);
    expect(body.verdict).toBe("open");
    expect(body.dustOutsideModel).toBe(14.1);
    expect(body.airExchangeSource).toBe("prior");
    const notes = (body.notes as string[]).join(" ");
    expect(notes).toMatch(/MODEL estimate/);
    expect(notes).toMatch(/literature value/);
    expect(notes).toMatch(/no checked source/);
  });

  it("tells the model plainly when there is not enough data", async () => {
    const r = await createVentilationTool(async () => ({ ...base, verdict: "unknown", reason: "no_outdoor_data", outside: null, predicted: null, predictedRange: null, gain: null, lambda: { value: 6, source: "data", verified: true, range: [5, 7] } })).run({}, ctx);
    const body = JSON.parse(r.content);
    expect(body.dustOutsideModel).toBeNull();
    expect((body.notes as string[]).join(" ")).toMatch(/not enough data/);
    expect((body.notes as string[]).join(" ")).not.toMatch(/literature value/);
  });
});
