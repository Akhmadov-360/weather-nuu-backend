import { z } from "zod";
import { SensorSourceSchema } from "./sensor.js";

/**
 * All valid bucket sizes for aggregated history. Ordered from smallest to
 * largest — the `auto` resolver picks the smallest one whose span/bucket
 * produces at most AGGREGATE_TARGET_POINTS. This list is the source of
 * truth for both server (date_bin) and client (label selection); adding
 * a new bucket here is enough to make it available end-to-end.
 */
export const AGGREGATE_BUCKETS = ["1m", "5m", "15m", "1h", "3h", "1d", "3d"] as const;
export type AggregateBucket = (typeof AGGREGATE_BUCKETS)[number];

/**
 * Postgres `interval` literal for each bucket — passed to `date_bin(...)`.
 * Kept next to the enum so drift is impossible: if you add "6h" here you
 * also add it to AGGREGATE_BUCKETS and vice versa.
 */
export const BUCKET_INTERVAL: Record<AggregateBucket, string> = {
  "1m": "1 minute",
  "5m": "5 minutes",
  "15m": "15 minutes",
  "1h": "1 hour",
  "3h": "3 hours",
  "1d": "1 day",
  "3d": "3 days",
};

/** Ms per bucket — used by the resolver and by the client to size axis ticks. */
export const BUCKET_MS: Record<AggregateBucket, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "3h": 3 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "3d": 3 * 24 * 60 * 60_000,
};

/**
 * Target number of visual points on the chart. The `auto` resolver picks
 * the finest bucket whose (span / bucket) stays at or under this number.
 * Kept generous enough to preserve interesting curve shapes but not so
 * high that ECharts starts sweating — anything above ~2k for a line
 * series on modest hardware starts stealing framerate.
 */
export const AGGREGATE_TARGET_POINTS = 1500;

/**
 * Given a range span in ms, returns the finest bucket whose bucketed
 * point count stays ≤ AGGREGATE_TARGET_POINTS. Falls back to the largest
 * bucket for ranges too wide to fit even at 3d granularity (i.e. multi-
 * year exports — the response will just be a coarser view than the
 * caller may have wanted, which is the right failure mode).
 *
 * Exported so both client and server can compute the same answer without
 * a round-trip — server enforces the resolution when `auto` is requested,
 * client uses it to choose x-axis labels and shape tooltips.
 */
export function resolveAutoBucket(spanMs: number): AggregateBucket {
  for (const bucket of AGGREGATE_BUCKETS) {
    if (spanMs / BUCKET_MS[bucket] <= AGGREGATE_TARGET_POINTS) return bucket;
  }
  return AGGREGATE_BUCKETS[AGGREGATE_BUCKETS.length - 1]!;
}

const AggregateBucketOrAutoSchema = z.union([z.enum(AGGREGATE_BUCKETS), z.literal("auto")]);

export const AggregateQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    /**
     * Explicit bucket, or `auto` (default) — let the server pick based on
     * the requested span. Server always echoes the resolved bucket back
     * so the client doesn't have to run the same resolver.
     */
    bucket: AggregateBucketOrAutoSchema.default("auto"),
  })
  .refine((q) => Date.parse(q.from) < Date.parse(q.to), {
    message: "`from` must be strictly before `to`",
    path: ["from"],
  });
export type AggregateQuery = z.infer<typeof AggregateQuerySchema>;

/**
 * Per-metric stats for one bucket. `null` when the bucket had no
 * measurements of that metric at all — separate from "we measured 0",
 * which is a real number.
 */
const MetricStatsSchema = z.object({
  avg: z.number().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
});
export type MetricStats = z.infer<typeof MetricStatsSchema>;

export const AggregateBucketSchema = z.object({
  /** Bucket start, ISO-8601 UTC. Interval width is fixed for the response. */
  ts: z.string().datetime({ offset: true }),
  /**
   * Raw measurements that fell into this bucket. Useful for data-quality
   * cues on the client — a bucket with count=3 when 360 were expected is
   * suspicious even if its avg looks fine.
   */
  count: z.number().int().nonnegative(),
  hum: MetricStatsSchema,
  press: MetricStatsSchema,
  mq5: MetricStatsSchema,
  mq3: MetricStatsSchema,
  temp: MetricStatsSchema,
});
export type AggregateBucketRow = z.infer<typeof AggregateBucketSchema>;

/**
 * Metadata block is not just decoration — with `bucket: "auto"` the
 * client can't know upfront what the server picked, and needs the
 * resolved value to render x-axis ticks / tooltips correctly. Echoing
 * `from`/`to` back removes ambiguity around whether the server clipped
 * or rounded the requested range.
 */
export const AggregateResponseSchema = z.object({
  source: SensorSourceSchema,
  bucket: z.enum(AGGREGATE_BUCKETS),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  items: z.array(AggregateBucketSchema),
});
export type AggregateResponse = z.infer<typeof AggregateResponseSchema>;
