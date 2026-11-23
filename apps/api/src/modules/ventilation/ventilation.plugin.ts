import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { env } from "../../env.js";
import { parseSchedule } from "../events/schedule.js";
import { SensorsAggregateRepo } from "../sensors/sensors.aggregate.repo.js";
import { OpenMeteoOutdoor } from "./outdoor.js";
import { createVentilationRoutes } from "./ventilation.routes.js";
import { VentilationService } from "./ventilation.service.js";

declare module "fastify" {
  interface FastifyInstance {
    ventilationService: VentilationService;
  }
}

/** The production wiring: the aggregation of the sensors, the model dust outside for the point of the station. Not encapsulated: the assistant takes the same service. */
export const ventilationPlugin: FastifyPluginAsync = fp(async (app) => {
  const repo = new SensorsAggregateRepo(app.db);
  const service = new VentilationService(
    {
      aggregate: ({ source, from, to }) => repo.aggregate({ source, from, to, bucket: "1m" }),
      outdoor: new OpenMeteoOutdoor({ lat: env.OUTDOOR_LAT, lon: env.OUTDOOR_LON }),
    },
    { schedule: parseSchedule(env.EVENTS_LESSON_STARTS, env.EVENTS_LESSON_ENDS), utcOffsetMin: env.EVENTS_UTC_OFFSET_MIN },
  );
  app.decorate("ventilationService", service);
  await app.register(createVentilationRoutes(service));
});
