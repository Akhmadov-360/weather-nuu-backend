import type { FastifyPluginAsyncZod, ZodTypeProvider } from "fastify-type-provider-zod";
import { EventsQuerySchema, EventsResponseSchema, type EventsResponse } from "@weather/contracts";

/** What the routes need: the events of a period. The service is passed in, so tests can run the routes with no database and no settings. */
export type EventsLister = { list(from: Date, to: Date): Promise<EventsResponse> };

/** Events of the auditorium found in the readings: `GET /v1/events?from=...&to=...` (at most 7 days). */
export function createEventsRoutes(service: EventsLister): FastifyPluginAsyncZod {
  return async (app) => {
    app.withTypeProvider<ZodTypeProvider>().get("/v1/events", { schema: { querystring: EventsQuerySchema, response: { 200: EventsResponseSchema } } }, async (request) =>
      service.list(new Date(request.query.from), new Date(request.query.to)),
    );
  };
}
