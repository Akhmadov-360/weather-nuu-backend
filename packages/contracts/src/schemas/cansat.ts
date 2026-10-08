import { z } from "zod";

export const CansatReadingInputSchema = z.object({
  temp: z.number().finite().optional(),
  pressure: z.number().finite().optional(),
  humidity: z.number().finite().optional(),
  accelX: z.number().finite().optional(),
});
export type CansatReadingInput = z.infer<typeof CansatReadingInputSchema>;

export const CansatReadingSchema = z.object({
  id: z.number().int(),
  temp: z.number().nullable(),
  pressure: z.number().nullable(),
  humidity: z.number().nullable(),
  accelX: z.number().nullable(),
  recordedAt: z.string().datetime({ offset: true }),
});
export type CansatReading = z.infer<typeof CansatReadingSchema>;

export const CansatHistoryResponseSchema = z.object({
  items: z.array(CansatReadingSchema),
  nextCursor: z.string().nullable(),
});
export type CansatHistoryResponse = z.infer<typeof CansatHistoryResponseSchema>;
