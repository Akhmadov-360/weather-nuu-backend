import { z } from "zod";
import { SensorReadingSchema } from "./schemas/sensor.js";
import { CansatReadingSchema } from "./schemas/cansat.js";

export const WsEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sensor.update"), payload: SensorReadingSchema }),
  z.object({ type: z.literal("cansat.update"), payload: CansatReadingSchema }),
]);
export type WsEvent = z.infer<typeof WsEventSchema>;
