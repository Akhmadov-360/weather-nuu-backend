import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { CansatHistoryResponseSchema, CansatReadingInputSchema, CansatReadingSchema, SensorHistoryQuerySchema } from "@weather/contracts";
import { CansatRepo } from "./cansat.repo.js";
import { CansatService } from "./cansat.service.js";

export const cansatRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new CansatService(new CansatRepo(app.db));

  app.post(
    "/v1/cansat",
    { preHandler: app.requireDeviceAuth, schema: { body: CansatReadingInputSchema, response: { 201: CansatReadingSchema } } },
    async (request, reply) => {
      const reading = await service.ingest(request.body);
      app.broadcast({ type: "cansat.update", payload: reading });
      reply.status(201).send(reading);
    },
  );

  app.get("/v1/cansat/latest", { schema: { response: { 200: CansatReadingSchema } } }, async () =>
    service.latest(),
  );

  app.get(
    "/v1/cansat/history",
    { schema: { querystring: SensorHistoryQuerySchema, response: { 200: CansatHistoryResponseSchema } } },
    async (request) => service.history(request.query),
  );
};
