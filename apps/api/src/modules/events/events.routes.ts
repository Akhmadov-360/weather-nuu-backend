import fp from "fastify-plugin";
import type { FastifyPluginAsyncZod, ZodTypeProvider } from "fastify-type-provider-zod";
import { EventsQuerySchema, EventsResponseSchema } from "@weather/contracts";
import { env } from "../../env.js";
import { SensorsAggregateRepo } from "../sensors/sensors.aggregate.repo.js";
import { EventsService } from "./events.service.js";
import { parseSchedule } from "./schedule.js";

/** Events of the auditorium found in the readings: `GET /v1/events?from=...&to=...` (at most 7 days). */
// Not encapsulated (fastify-plugin): the assistant takes the same service for its tool `get_events`.
export const eventsRoutes: FastifyPluginAsyncZod = fp(async (app) => {
  const repo = new SensorsAggregateRepo(app.db);
  const service = new EventsService(
    { aggregate: ({ source, from, to }) => repo.aggregate({ source, from, to, bucket: "1m" }) },
    { schedule: parseSchedule(env.EVENTS_LESSON_STARTS, env.EVENTS_LESSON_ENDS), utcOffsetMin: env.EVENTS_UTC_OFFSET_MIN },
  );
  app.decorate("eventsService", service);

  app.withTypeProvider<ZodTypeProvider>().get("/v1/events", { schema: { querystring: EventsQuerySchema, response: { 200: EventsResponseSchema } } }, async (request) =>
    service.list(new Date(request.query.from), new Date(request.query.to)),
  );
}) as FastifyPluginAsyncZod;

declare module "fastify" {
  interface FastifyInstance {
    eventsService: EventsService;
  }
}
