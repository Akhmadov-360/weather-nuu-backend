import type { FastifyPluginAsyncZod, ZodTypeProvider } from "fastify-type-provider-zod";
import { VentilationAdviceSchema, type VentilationAdvice } from "@weather/contracts";

/** What the routes need. The service is passed in, so that tests run the routes with no database and no settings. */
export type VentilationAdviser = { advice(): Promise<VentilationAdvice> };

/** Advice on opening the window of the auditorium: `GET /v1/ventilation/advice`. */
export function createVentilationRoutes(service: VentilationAdviser): FastifyPluginAsyncZod {
  return async (app) => {
    app.withTypeProvider<ZodTypeProvider>().get("/v1/ventilation/advice", { schema: { response: { 200: VentilationAdviceSchema } } }, async () => service.advice());
  };
}
