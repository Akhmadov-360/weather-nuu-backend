import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { env } from "../../env.js";
import { SensorsAggregateRepo } from "../sensors/sensors.aggregate.repo.js";
import { EventsService } from "./events.service.js";
import { createEventsRoutes } from "./events.routes.js";
import { parseSchedule } from "./schedule.js";

declare module "fastify" {
  interface FastifyInstance {
    eventsService: EventsService;
  }
}

/**
 * The production wiring: settings from the environment, the real aggregation behind the service. Not encapsulated
 * (fastify-plugin): the assistant takes the same service for its tool `get_events`.
 */
export const eventsPlugin: FastifyPluginAsync = fp(async (app) => {
  const repo = new SensorsAggregateRepo(app.db);
  const service = new EventsService(
    { aggregate: ({ source, from, to }) => repo.aggregate({ source, from, to, bucket: "1m" }) },
    { schedule: parseSchedule(env.EVENTS_LESSON_STARTS, env.EVENTS_LESSON_ENDS), utcOffsetMin: env.EVENTS_UTC_OFFSET_MIN },
  );
  app.decorate("eventsService", service);
  await app.register(createEventsRoutes(service));
});
