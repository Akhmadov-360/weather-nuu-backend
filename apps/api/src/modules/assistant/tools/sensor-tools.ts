import { z } from "zod";
import {
  resolveAutoBucket,
  SensorSourceSchema,
  type AggregateBucketRow,
  type MetricStats,
  type SensorReading,
  type SensorSource,
} from "@weather/contracts";
import { aqi, categorize, getStandard, type Pollutant } from "@weather/air-quality";
import type { SensorsAggregateRepo } from "../../sensors/sensors.aggregate.repo.js";
import type { SensorsService } from "../../sensors/sensors.service.js";
import { defineTool, ToolError, type Tool } from "./registry.js";

/** The longest period a tool will summarise: a question about a year is not answered with a year of rows. */
export const MAX_RANGE_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A reading older than this is reported as stale (the sensors send about every 5 seconds). */
const STALE_AFTER_S = 5 * 60;

export type SensorToolDeps = {
  latest(source: SensorSource): Promise<SensorReading>;
  aggregate(params: { source: SensorSource; from: Date; to: Date }): Promise<AggregateBucketRow[]>;
};

/** Wires the tools to the real services: the bucket width is chosen from the span, as the chart does. */
export function sensorToolDepsFrom(service: SensorsService, repo: SensorsAggregateRepo): SensorToolDeps {
  return {
    latest: (source) => service.latest(source),
    aggregate: ({ source, from, to }) => repo.aggregate({ source, from, to, bucket: resolveAutoBucket(to.getTime() - from.getTime()) }),
  };
}

const METRICS = {
  temperature: { key: "temp", unit: "°C" },
  humidity: { key: "hum", unit: "%" },
  pressure: { key: "press", unit: "hPa" },
  pm25: { key: "pm25", unit: "µg/m³" },
  pm10: { key: "pm10", unit: "µg/m³" },
  mq5: { key: "mq5", unit: "ppm" },
  mq3: { key: "mq3", unit: "ppm" },
} as const;
type MetricName = keyof typeof METRICS;
const METRIC_NAMES = Object.keys(METRICS) as [MetricName, ...MetricName[]];

const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

function dust(pollutant: Pollutant, value: number | null) {
  if (value === null) return null;
  const standard = getStandard();
  return { value, aqi: aqi(standard, pollutant, value), category: categorize(standard, pollutant, value) };
}

type MetricSummary =
  | { available: false; note: string }
  | { available: true; unit: string; avg: number; min: number; max: number; trend: "rising" | "falling" | "steady"; readings: number; aqi?: number | null; category?: string | null };

const NO_DATA: MetricSummary = { available: false, note: "No data for this metric in the period." };

/** Mean weighted by how many readings each bucket holds, extremes over all buckets, trend from the first and last thirds. */
function summarizeMetric(rows: AggregateBucketRow[], name: MetricName): MetricSummary {
  const key = METRICS[name].key;
  const points = rows
    .map((row) => ({ stats: row[key] as MetricStats, count: row.count }))
    .filter((p) => p.stats.avg !== null);
  if (points.length === 0) return NO_DATA;

  const readings = points.reduce((n, p) => n + p.count, 0);
  const avg = points.reduce((sum, p) => sum + (p.stats.avg as number) * p.count, 0) / readings;
  const mins = points.map((p) => p.stats.min).filter((v): v is number => v !== null);
  const maxs = points.map((p) => p.stats.max).filter((v): v is number => v !== null);

  const third = Math.max(1, Math.floor(points.length / 3));
  const mean = (part: typeof points) => part.reduce((s, p) => s + (p.stats.avg as number), 0) / part.length;
  const change = points.length < 2 ? 0 : mean(points.slice(-third)) - mean(points.slice(0, third));
  const threshold = Math.max(0.05 * Math.abs(avg), 0.1);
  const trend = change > threshold ? "rising" : change < -threshold ? "falling" : "steady";

  const summary: MetricSummary = {
    available: true,
    unit: METRICS[name].unit,
    avg: round(avg),
    min: Math.min(...mins),
    max: Math.max(...maxs),
    trend,
    readings,
  };
  if (name === "pm25" || name === "pm10") {
    const d = dust(name, avg);
    summary.aqi = d?.aqi ?? null;
    summary.category = d?.category ?? null;
  }
  return summary;
}

const PeriodSchema = z.object({
  from: z.string().datetime({ offset: true }).describe("Start of the period, ISO 8601 with a time zone"),
  to: z.string().datetime({ offset: true }).describe("End of the period, ISO 8601 with a time zone"),
});

function checkedPeriod(args: { from: string; to: string }): { from: Date; to: Date } {
  const from = new Date(args.from);
  const to = new Date(args.to);
  if (!(from < to)) throw new ToolError("The period must start before it ends.");
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw new ToolError(`The period is longer than ${MAX_RANGE_DAYS} days. Ask for a shorter period.`);
  }
  return { from, to };
}

const MQ_NOTE = "MQ-5 is a combustible-gas (LPG) estimate and MQ-3 an alcohol-vapour estimate, both in ppm; neither measures CO2.";

export function createSensorTools(deps: SensorToolDeps): Tool[] {
  const getCurrent = defineTool({
    name: "get_current",
    description: "The latest readings of one sensor (room = the auditorium, street = outside the window): temperature, humidity, pressure, dust PM2.5 and PM10 with the AQI category, gas sensors, and how old the reading is.",
    schema: z.object({ source: SensorSourceSchema }),
    handler: async ({ source }, ctx) => {
      const r = await deps.latest(source);
      const ageSeconds = Math.max(0, Math.round((ctx.now.getTime() - Date.parse(r.recordedAt)) / 1000));
      const notes: string[] = [];
      if (source === "street") notes.push("The street has no dust sensor: there is no dust reading outside.");
      else if (r.pm25 === null) notes.push("The dust reading is not available right now.");
      if (r.mq5 !== null || r.mq3 !== null) notes.push(MQ_NOTE);
      return {
        source,
        recordedAt: r.recordedAt,
        ageSeconds,
        stale: ageSeconds > STALE_AFTER_S,
        temperatureC: r.fusedTemp,
        humidityPercent: r.hum,
        pressureHpa: r.bmpPress,
        pm25: dust("pm25", r.pm25),
        pm10: dust("pm10", r.pm10),
        mq5Ppm: r.mq5,
        mq3Ppm: r.mq3,
        notes,
      };
    },
  });

  const getPeriodSummary = defineTool({
    name: "get_period_summary",
    description: `Average, lowest, highest and trend of chosen metrics of one sensor over a period of at most ${MAX_RANGE_DAYS} days.`,
    schema: PeriodSchema.extend({
      source: SensorSourceSchema,
      metrics: z.array(z.enum(METRIC_NAMES)).min(1).max(METRIC_NAMES.length),
    }),
    handler: async (args) => {
      const { from, to } = checkedPeriod(args);
      const rows = await deps.aggregate({ source: args.source, from, to });
      return {
        source: args.source,
        from: from.toISOString(),
        to: to.toISOString(),
        readings: rows.reduce((n, row) => n + row.count, 0),
        metrics: Object.fromEntries(args.metrics.map((name) => [name, summarizeMetric(rows, name)])),
      };
    },
  });

  const compareRoomStreet = defineTool({
    name: "compare_room_street",
    description: "Mean values inside (room) and outside (street) over the same period, and the difference. Dust cannot be compared: the street has no dust sensor.",
    schema: PeriodSchema.extend({ metric: z.enum(["temperature", "humidity", "pressure", "pm25", "pm10"]) }),
    handler: async (args) => {
      if (args.metric === "pm25" || args.metric === "pm10") {
        throw new ToolError("The street has no dust sensor, so dust inside cannot be compared with dust outside.");
      }
      const { from, to } = checkedPeriod(args);
      const [roomRows, streetRows] = await Promise.all([
        deps.aggregate({ source: "room", from, to }),
        deps.aggregate({ source: "street", from, to }),
      ]);
      const room = summarizeMetric(roomRows, args.metric);
      const street = summarizeMetric(streetRows, args.metric);
      return {
        metric: args.metric,
        unit: METRICS[args.metric].unit,
        from: from.toISOString(),
        to: to.toISOString(),
        room,
        street,
        differenceRoomMinusStreet: room.available && street.available ? round(room.avg - street.avg) : null,
      };
    },
  });

  return [getCurrent, getPeriodSummary, compareRoomStreet];
}
