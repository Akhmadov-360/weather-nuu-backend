import { z } from "zod";
import { SensorSourceSchema } from "./sensor.js";

/**
 * "source" here is any dataset the export endpoint knows how to stream.
 * cansat is included because it shares the same export pipeline.
 */
export const ExportSourceSchema = z.union([SensorSourceSchema, z.literal("cansat")]);
export type ExportSource = z.infer<typeof ExportSourceSchema>;

export const ExportFormatSchema = z.enum(["csv", "ndjson", "xlsx"]);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

/** UI language — used to localize XLSX headers/sheet names, ignored by csv/ndjson. */
export const ExportLangSchema = z.enum(["en", "ru", "uz"]);
export type ExportLang = z.infer<typeof ExportLangSchema>;

/**
 * Range is optional on both ends: omitting `from` means "from the very
 * first record we have for this source" — this is what lets users pull
 * the full history from day one without knowing the exact start date.
 */
export const ExportQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    format: ExportFormatSchema.default("csv"),
    /**
     * A gap in the stream is flagged when two consecutive readings are
     * further apart than this. Default is tuned to ~3x the expected
     * sampling interval so short network hiccups aren't reported as
     * outages. Sensors going offline for hours (documented case) always
     * surfaces as a gap regardless of this value.
     */
    gapThresholdMinutes: z.coerce.number().int().min(1).max(1440).default(15),
    /** UI language for XLSX headers (ignored by csv/ndjson). */
    lang: ExportLangSchema.default("en"),
  })
  .refine((q) => !q.from || !q.to || Date.parse(q.from) <= Date.parse(q.to), {
    // Lexical string comparison breaks for two valid ISO instants with
    // different (but both legal) UTC offsets — compare by actual instant.
    message: "`from` must be before or equal to `to`",
    path: ["from"],
  });
export type ExportQuery = z.infer<typeof ExportQuerySchema>;

/**
 * Query for the calendar-aware "pick a set of months to download"
 * endpoint. Each month is a "YYYY-MM" string; the server expands it to
 * the calendar-month UTC range and streams one file per month. A single
 * month collapses to a flat CSV/XLSX; multiple months are wrapped in a
 * ZIP alongside a monthly `summary.csv` — the auto-wrap keeps the UX
 * simple (no "one file / multiple files?" question), and avoids Excel's
 * 1,048,576-row limit on wide multi-month exports.
 *
 * `months` is a comma-separated list because URL query strings compose
 * cleanly that way and stay copy-pasteable for automation.
 */
export const ExportByMonthsQuerySchema = z.object({
  months: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])(,\d{4}-(0[1-9]|1[0-2]))*$/, {
      message: "expected `months=YYYY-MM,YYYY-MM,...`",
    })
    .transform((v) => Array.from(new Set(v.split(","))).sort()),
  /** csv keeps it a plain table; xlsx is friendlier for opening straight in Excel. */
  format: z.enum(["csv", "xlsx"]).default("csv"),
  lang: ExportLangSchema.default("en"),
});
export type ExportByMonthsQuery = z.infer<typeof ExportByMonthsQuerySchema>;

/** One row of an export stream is either real data or an explicit gap marker. */
export const ExportRowSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("reading"),
    recordedAt: z.string().datetime({ offset: true }),
    values: z.record(z.string(), z.number().nullable()),
  }),
  z.object({
    kind: z.literal("gap"),
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    approxMissingReadings: z.number().int().nonnegative(),
  }),
]);
export type ExportRow = z.infer<typeof ExportRowSchema>;

/** Bounds + volume so the frontend can build a range picker and warn about size before downloading. */
export const ExportMetaSchema = z.object({
  source: ExportSourceSchema,
  earliestRecordedAt: z.string().datetime({ offset: true }).nullable(),
  latestRecordedAt: z.string().datetime({ offset: true }).nullable(),
  totalCount: z.number().int().nonnegative(),
});
export type ExportMeta = z.infer<typeof ExportMetaSchema>;
