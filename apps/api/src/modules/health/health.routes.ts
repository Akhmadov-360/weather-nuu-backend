import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/health",
    { schema: { response: { 200: z.object({ status: z.literal("ok"), db: z.literal("ok") }) } } },
    async () => {
      await app.db.execute(sql`select 1`);
      return { status: "ok" as const, db: "ok" as const };
    },
  );
};
