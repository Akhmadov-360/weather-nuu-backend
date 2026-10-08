import Fastify from "fastify";
import cors from "@fastify/cors";
import compress from "@fastify/compress";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { env } from "./env.js";
import { dbPlugin } from "./plugins/db.js";
import { errorHandlerPlugin } from "./plugins/error-handler.js";
import { websocketPlugin } from "./plugins/websocket.js";
import { deviceAuthPlugin } from "./plugins/device-auth.js";
import { sensorsRoutes } from "./modules/sensors/sensors.routes.js";
import { cansatRoutes } from "./modules/cansat/cansat.routes.js";
import { exportRoutes } from "./modules/export/export.routes.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { registerHourlySnapshot } from "./jobs/hourly-snapshot.js";

export async function buildApp() {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, { origin: env.CORS_ORIGIN });
  // Register the WebSocket plugin BEFORE compress so its handshake hooks
  // are installed first — `@fastify/compress` in global mode installs an
  // `onSend` hook that intermittently races against the 101 Switching
  // Protocols response, producing sporadic 502s at nginx (recv() ECONNRESET
  // from upstream during WS upgrade). Registering WS first, and letting
  // compress be non-global, keeps upgrade traffic away from the encoder.
  await app.register(websocketPlugin);
  // Non-global compress: the export endpoint is the one place that
  // benefits from app-level compression (streamed multi-MB CSV/XLSX).
  // Regular API JSON responses are small enough that nginx's gzip on
  // the way out handles them; we set that up explicitly in the site
  // config too so proxied JSON/CSV actually gets compressed.
  await app.register(compress, { global: false });
  await app.register(dbPlugin);
  await app.register(errorHandlerPlugin);
  await app.register(deviceAuthPlugin);

  await app.register(healthRoutes);
  await app.register(sensorsRoutes);
  await app.register(cansatRoutes);
  await app.register(exportRoutes);

  registerHourlySnapshot(app);

  return app;
}
