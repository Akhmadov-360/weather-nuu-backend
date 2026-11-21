import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { env } from "../../env.js";
import { SensorsAggregateRepo } from "../sensors/sensors.aggregate.repo.js";
import { SensorsRepo } from "../sensors/sensors.repo.js";
import { SensorsService } from "../sensors/sensors.service.js";
import { createAssistantRoutes } from "./assistant.routes.js";
import { createProvider } from "./providers/factory.js";
import { createRateLimiter } from "./rate-limiter.js";
import { ToolRegistry } from "./tools/registry.js";
import { createSensorTools, sensorToolDepsFrom } from "./tools/sensor-tools.js";

/** The production wiring: settings from the environment, the real sensor services behind the tools. */
export const assistantRoutes: FastifyPluginAsyncZod = async (app) => {
  const provider = createProvider(env);
  if (env.ASSISTANT_ENABLED && !provider) {
    app.log.warn({ provider: env.ASSISTANT_PROVIDER }, "assistant is enabled but has no provider to use: it will report 503");
  }
  const registry = new ToolRegistry(createSensorTools(sensorToolDepsFrom(new SensorsService(new SensorsRepo(app.db)), new SensorsAggregateRepo(app.db))));
  await app.register(
    createAssistantRoutes({
      enabled: env.ASSISTANT_ENABLED,
      provider,
      registry,
      limiter: createRateLimiter({
        perMinute: env.ASSISTANT_RATE_PER_MIN,
        perHour: env.ASSISTANT_RATE_PER_HOUR,
        globalPerMinute: env.ASSISTANT_RATE_GLOBAL_PER_MIN,
      }),
      maxOutputTokens: env.ASSISTANT_MAX_OUTPUT_TOKENS,
      now: () => new Date(),
      pingMs: 15_000,
    }),
  );
};
