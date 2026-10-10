import { sql } from "drizzle-orm";
import type { db as Db } from "../../db/client.js";
import type { AggregateBucket, AggregateBucketRow, SensorSource } from "@weather/contracts";
import { BUCKET_INTERVAL } from "@weather/contracts";

/**
 * Postgres 14+ `date_bin(interval, ts, origin)` groups timestamps into
 * fixed-width buckets aligned to `origin`. Unlike `date_trunc`, it
 * accepts arbitrary intervals (`5 minutes`, `3 hours`) — which is the
 * whole point of the configurable bucket enum in @weather/contracts.
 *
 * The origin is fixed to 2000-01-01 UTC so bucket boundaries are stable
 * across queries: `date_bin('15m', ts, 2000-01-01)` for the same `ts`
 * always yields the same bucket start, regardless of when the query ran.
 * Without a stable origin, adjacent queries could disagree on where the
 * `10:00-10:15` bucket ends.
 */
const BUCKET_ORIGIN = "2000-01-01T00:00:00Z";

type Row = {
  // `pg` returns Date for typed columns but a string for computed
  // expressions like `date_bin(...)` — normalize both cases in the mapper.
  bucket: Date | string;
  n: string; // pg driver returns COUNT as string for bigint compatibility
  hum_avg: string | null;
  hum_min: number | null;
  hum_max: number | null;
  press_avg: string | null;
  press_min: number | null;
  press_max: number | null;
  mq5_avg: string | null;
  mq5_min: number | null;
  mq5_max: number | null;
  mq3_avg: string | null;
  mq3_min: number | null;
  mq3_max: number | null;
  temp_avg: string | null;
  temp_min: number | null;
  temp_max: number | null;
  pm25_avg: string | null;
  pm25_min: number | null;
  pm25_max: number | null;
  pm10_avg: string | null;
  pm10_min: number | null;
  pm10_max: number | null;
};

function num(v: string | number | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

export class SensorsAggregateRepo {
  constructor(private readonly db: typeof Db) {}

  async aggregate(params: {
    source: SensorSource;
    from: Date;
    to: Date;
    bucket: AggregateBucket;
  }): Promise<AggregateBucketRow[]> {
    const interval = BUCKET_INTERVAL[params.bucket];
    // Written as raw SQL because drizzle doesn't model `date_bin` and
    // we're already grouping by a computed expression — the query is
    // simple enough that a query-builder rewrite would just add ceremony.
    const query = sql`
      SELECT
        date_bin(${interval}::interval, "timestamp", ${BUCKET_ORIGIN}::timestamptz) AS bucket,
        COUNT(*) AS n,
        AVG(hum)        AS hum_avg,   MIN(hum)        AS hum_min,   MAX(hum)        AS hum_max,
        AVG(bmp_press)  AS press_avg, MIN(bmp_press)  AS press_min, MAX(bmp_press)  AS press_max,
        AVG(mq5)        AS mq5_avg,   MIN(mq5)        AS mq5_min,   MAX(mq5)        AS mq5_max,
        AVG(mq3)        AS mq3_avg,   MIN(mq3)        AS mq3_min,   MAX(mq3)        AS mq3_max,
        AVG(fused_temp) AS temp_avg,  MIN(fused_temp) AS temp_min,  MAX(fused_temp) AS temp_max,
        AVG(pm25)       AS pm25_avg,  MIN(pm25)       AS pm25_min,  MAX(pm25)       AS pm25_max,
        AVG(pm10)       AS pm10_avg,  MIN(pm10)       AS pm10_min,  MAX(pm10)       AS pm10_max
      FROM sensor_data
      WHERE source = ${params.source}
        AND "timestamp" >= ${params.from.toISOString()}::timestamptz
        AND "timestamp" <  ${params.to.toISOString()}::timestamptz
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    const result = await this.db.execute(query);
    const rows = result.rows as unknown as Row[];

    return rows.map((r) => ({
      ts: (r.bucket instanceof Date ? r.bucket : new Date(r.bucket)).toISOString(),
      count: Number(r.n),
      hum:   { avg: num(r.hum_avg),   min: num(r.hum_min),   max: num(r.hum_max) },
      press: { avg: num(r.press_avg), min: num(r.press_min), max: num(r.press_max) },
      mq5:   { avg: num(r.mq5_avg),   min: num(r.mq5_min),   max: num(r.mq5_max) },
      mq3:   { avg: num(r.mq3_avg),   min: num(r.mq3_min),   max: num(r.mq3_max) },
      temp:  { avg: num(r.temp_avg),  min: num(r.temp_min),  max: num(r.temp_max) },
      pm25:  { avg: num(r.pm25_avg),  min: num(r.pm25_min),  max: num(r.pm25_max) },
      pm10:  { avg: num(r.pm10_avg),  min: num(r.pm10_min),  max: num(r.pm10_max) },
    }));
  }
}
