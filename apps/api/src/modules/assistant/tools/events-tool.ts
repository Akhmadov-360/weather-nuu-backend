import { z } from "zod";
import type { EventsResponse } from "@weather/contracts";
import { defineTool, ToolError, type Tool } from "./registry.js";

const DAY_MS = 86_400_000;
const MAX_DAYS = 7;

/**
 * The events the platform found in the room's readings (open window, cleaning, air conditioner, lessons).
 * Short answer for the model: what, when, and how sure; and the reminder that nobody wrote the events down.
 */
/** "09:56" on the wall clock of the station, from a UTC instant. */
function localTime(iso: string, utcOffsetMin: number): string {
  const d = new Date(Date.parse(iso) + utcOffsetMin * 60_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function createEventsTool(list: (from: Date, to: Date) => Promise<EventsResponse>, options: { utcOffsetMin?: number } = {}): Tool {
  const offset = options.utcOffsetMin ?? 300;
  return defineTool({
    name: "get_events",
    description: `Events that the platform found automatically in the readings of the room (the auditorium) over a period of at most ${MAX_DAYS} days: an open window (ventilation), cleaning, the air conditioner running, and, if a schedule is configured, the start and end of a lesson. Use it for questions like "was the window opened today", "when was it ventilated".`,
    schema: z.object({
      from: z.string().datetime({ offset: true }).describe("Start of the period, ISO-8601"),
      to: z.string().datetime({ offset: true }).describe("End of the period, ISO-8601"),
    }),
    handler: async ({ from, to }) => {
      const a = new Date(from);
      const b = new Date(to);
      if (!(a < b)) throw new ToolError("The period must start before it ends.");
      if (b.getTime() - a.getTime() > MAX_DAYS * DAY_MS) throw new ToolError(`The period is longer than ${MAX_DAYS} days. Ask for a shorter period.`);
      const result = await list(a, b);
      return {
        from: result.from,
        to: result.to,
        count: result.events.length,
        events: result.events.map((e) => ({ type: e.cls, start: e.start, startLocalTime: localTime(e.start, offset), confirmedByStreetAir: e.confirmedByStreet })),
        kinds: result.method.classes,
        coverageMinutes: result.coverageMinutes,
        note:
          "Times in `start` are UTC; tell the visitor `startLocalTime` (the clock of the station) and do not mention UTC. " +
          "These events are found by the system from the readings, nobody wrote them down: say \"the system detected\", not \"it happened\". " +
          "The method has been checked on synthetic data only. An empty list can also mean that the readings are missing (see coverageMinutes). Lessons are listed only if kinds contains class_start or class_end.",
      };
    },
  });
}
