import { z } from "zod";

export const VENTILATION_VERDICTS = ["open", "dont_open", "wait", "not_needed", "unknown"] as const;
export const VentilationVerdictSchema = z.enum(VENTILATION_VERDICTS);
export type VentilationVerdict = z.infer<typeof VentilationVerdictSchema>;

export const VENTILATION_REASONS = ["outside_cleaner", "outside_worse", "outside_dirty", "no_gain", "comfort", "already_good", "forecast_better", "no_outdoor_data", "no_indoor_data"] as const;
export const VentilationReasonSchema = z.enum(VENTILATION_REASONS);
export type VentilationReason = z.infer<typeof VentilationReasonSchema>;

const Instant = z.string().datetime({ offset: true });

/** Advice on opening the window of the auditorium: `GET /v1/ventilation/advice`. */
export const VentilationAdviceSchema = z.object({
  verdict: VentilationVerdictSchema,
  reason: VentilationReasonSchema,
  computedAt: Instant,
  /** Dust inside now (the mean of the last minutes of the Room kit), µg/m³; `null` when the kit is silent. */
  inside: z.object({ pm25: z.number(), at: Instant }).nullable(),
  /**
   * Dust outside. The Street kit has no dust sensor, so this is a model estimate (not a measurement), and the
   * answer says so and names the source, as its licence asks.
   */
  outside: z
    .object({
      pm25: z.number(),
      at: Instant,
      kind: z.literal("model"),
      source: z.string(),
      attributionUrl: z.string().url(),
    })
    .nullable(),
  /** Temperature at the Street kit, °C; `null` when it is silent. */
  outsideTemp: z.number().nullable(),
  /** After how many minutes the effect of an open window is estimated. */
  horizonMinutes: z.number().int().positive(),
  /** The dust inside expected after that time with the window open, and the range from the uncertainty of the speed, µg/m³. */
  predicted: z.number().nullable(),
  predictedRange: z.tuple([z.number(), z.number()]).nullable(),
  /** How much lower the dust inside is expected to be, µg/m³. */
  gain: z.number().nullable(),
  /** The speed of air exchange with the window open that the estimate used. */
  lambda: z.object({
    value: z.number().positive(),
    /** `data`: measured in this room; `prior`: a literature value that has not been measured here. */
    source: z.enum(["data", "prior"]),
    /** False while the literature value has no source that has been read and checked. */
    verified: z.boolean(),
    range: z.tuple([z.number(), z.number()]).nullable(),
  }),
  /** What the model expects outside in the next hours (hours ahead, µg/m³). */
  forecast: z.array(z.object({ hours: z.number(), value: z.number() })),
});
export type VentilationAdvice = z.infer<typeof VentilationAdviceSchema>;
