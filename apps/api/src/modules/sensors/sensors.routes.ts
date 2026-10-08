import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  AggregateQuerySchema,
  AggregateResponseSchema,
  resolveAutoBucket,
  SensorHistoryQuerySchema,
  SensorHistoryResponseSchema,
  SensorReadingInputSchema,
  SensorReadingSchema,
  SensorSourceSchema,
} from "@weather/contracts";
import { z } from "zod";
import { SensorsRepo } from "./sensors.repo.js";
import { SensorsAggregateRepo } from "./sensors.aggregate.repo.js";
import { SensorsService } from "./sensors.service.js";

export const sensorsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new SensorsService(new SensorsRepo(app.db));
  const aggregateRepo = new SensorsAggregateRepo(app.db);
  const sourceParam = z.object({ source: SensorSourceSchema });

  app.post(
    "/v1/sensors/:source",
    {
      preHandler: app.requireDeviceAuth,
      schema: { params: sourceParam, body: SensorReadingInputSchema, response: { 201: SensorReadingSchema } },
    },
    async (request, reply) => {
      const reading = await service.ingest(request.params.source, request.body);
      app.broadcast({ type: "sensor.update", payload: reading });
      reply.status(201).send(reading);
    },
  );

  app.get(
    "/v1/sensors/:source/latest",
    { schema: { params: sourceParam, response: { 200: SensorReadingSchema } } },
    async (request) => service.latest(request.params.source),
  );

  app.get(
    "/v1/sensors/:source/history",
    {
      schema: {
        params: sourceParam,
        querystring: SensorHistoryQuerySchema,
        response: { 200: SensorHistoryResponseSchema },
      },
    },
    async (request) =>
      service.history({
        source: request.params.source,
        from: request.query.from,
        to: request.query.to,
        cursor: request.query.cursor,
        limit: request.query.limit,
      }),
  );

  /**
   * Bucketed aggregate — the "analytics" side of the raw/aggregate split.
   * Same source table, but grouped by fixed-width time bucket so a 90-day
   * range comes back as ~700 rows instead of ~300 000. Client picks
   * bucket=auto and the resolver here decides based on requested span.
   * See docs/decisions/history-analytics.md for the rationale.
   */
  app.get(
    "/v1/sensors/:source/aggregate",
    {
      schema: {
        params: sourceParam,
        querystring: AggregateQuerySchema,
        response: { 200: AggregateResponseSchema },
      },
    },
    async (request) => {
      const { source } = request.params;
      const { from, to, bucket: requestedBucket } = request.query;
      const fromDate = new Date(from);
      const toDate = new Date(to);
      const bucket =
        requestedBucket === "auto"
          ? resolveAutoBucket(toDate.getTime() - fromDate.getTime())
          : requestedBucket;

      const items = await aggregateRepo.aggregate({ source, from: fromDate, to: toDate, bucket });
      return { source, bucket, from: fromDate.toISOString(), to: toDate.toISOString(), items };
    },
  );
};
