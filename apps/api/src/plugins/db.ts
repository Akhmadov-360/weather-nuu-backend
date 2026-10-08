import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { db, pool } from "../db/client.js";

declare module "fastify" {
  interface FastifyInstance {
    db: typeof db;
  }
}

export const dbPlugin: FastifyPluginAsync = fp(async (app) => {
  app.decorate("db", db);
  app.addHook("onClose", async () => {
    await pool.end();
  });
});
