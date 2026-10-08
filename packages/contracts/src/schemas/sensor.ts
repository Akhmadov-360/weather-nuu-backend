import { z } from "zod";

export const SensorSourceSchema = z.enum(["room", "street"]);
export type SensorSource = z.infer<typeof SensorSourceSchema>;

/**
 * Body accepted from the firmware on POST /v1/sensors/:source. The two
 * deployed sketches (Room/Street LAST.ino) actually send snake_case keys
 * — `bmp_press`, `fused_temp` — matching the old Python backend's field
 * names, not the camelCase used everywhere else in this codebase. Rather
 * than force a firmware re-flash (both devices are already out in the
 * field), this preprocesses the raw body and renames the known aliases
 * before validating against the camelCase shape the rest of the app
 * expects. A device sending camelCase directly would also pass through
 * untouched, so this is backward- and forward-compatible.
 */
const SNAKE_CASE_ALIASES: Record<string, string> = {
  bmp_press: "bmpPress",
  fused_temp: "fusedTemp",
};

export const SensorReadingInputSchema = z.preprocess((raw) => {
  if (typeof raw !== "object" || raw === null) return raw;
  const renamed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    renamed[SNAKE_CASE_ALIASES[key] ?? key] = value;
  }
  return renamed;
}, z.object({
  hum: z.number().finite().optional(),
  bmpPress: z.number().finite().optional(),
  mq5: z.number().finite().optional(),
  mq3: z.number().finite().optional(),
  fusedTemp: z.number().finite().optional(),
}));
export type SensorReadingInput = z.infer<typeof SensorReadingInputSchema>;

/**
 * What the API returns. `recordedAt` is always a real ISO-8601 UTC
 * instant — no more "DD-MM HH:mm" without a year and no more
 * client-side heuristics to guess which year/century it means.
 */
export const SensorReadingSchema = z.object({
  id: z.number().int(),
  source: SensorSourceSchema,
  hum: z.number().nullable(),
  bmpPress: z.number().nullable(),
  mq5: z.number().nullable(),
  mq3: z.number().nullable(),
  fusedTemp: z.number().nullable(),
  recordedAt: z.string().datetime({ offset: true }),
});
export type SensorReading = z.infer<typeof SensorReadingSchema>;

export const SensorHistoryQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(10_000).default(2000),
  /** Opaque — pass back exactly what `nextCursor` returned, don't construct it. */
  cursor: z.string().optional(),
});
export type SensorHistoryQuery = z.infer<typeof SensorHistoryQuerySchema>;

export const SensorHistoryResponseSchema = z.object({
  items: z.array(SensorReadingSchema),
  nextCursor: z.string().nullable(),
});
export type SensorHistoryResponse = z.infer<typeof SensorHistoryResponseSchema>;
