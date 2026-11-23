import { z } from "zod";

/** What the platform can recognise in the data of the auditorium. Heating is not among them: it is too slow to be an event. */
export const ROOM_EVENT_CLASSES = ["ventilation", "class_start", "class_end", "cleaning", "ac"] as const;
export const RoomEventClassSchema = z.enum(ROOM_EVENT_CLASSES);
export type RoomEventClass = z.infer<typeof RoomEventClassSchema>;

/** The longest period one request may cover. */
export const EVENTS_MAX_DAYS = 7;

export const EventsQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .refine((q) => Date.parse(q.from) < Date.parse(q.to), { message: "`from` must be strictly before `to`", path: ["from"] })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= EVENTS_MAX_DAYS * 86_400_000, {
    message: `The period is longer than ${EVENTS_MAX_DAYS} days`,
    path: ["to"],
  });
export type EventsQuery = z.infer<typeof EventsQuerySchema>;

export const RoomEventSchema = z.object({
  cls: RoomEventClassSchema,
  /** When the change began, ISO-8601. */
  start: z.string().datetime({ offset: true }),
  /** When the system could first say so (always after `start`). */
  detected: z.string().datetime({ offset: true }),
  /**
   * Ventilation only: did the air of the room come closer to the street air (the independent witness)?
   * `null` when the room and the street were too alike to tell, and for every other class.
   */
  confirmedByStreet: z.boolean().nullable(),
});
export type RoomEvent = z.infer<typeof RoomEventSchema>;

export const EventsResponseSchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  /** Oldest first. */
  events: z.array(RoomEventSchema),
  /** How the events were found, so that nobody reads them as a log kept by people. */
  method: z.object({
    name: z.literal("cusum-rules-v1"),
    /** True until the method is checked on the readings of the real room (it is checked on synthetic series only). */
    experimental: z.boolean(),
    /** Classes the method can tell apart in this setup (the lessons need a schedule). */
    classes: z.array(RoomEventClassSchema),
  }),
  /** Minutes of the period that have readings of the room; a low number means "no events" may mean "no data". */
  coverageMinutes: z.number().int().nonnegative(),
});
export type EventsResponse = z.infer<typeof EventsResponseSchema>;
