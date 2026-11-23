import { fileURLToPath } from "node:url";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { env } from "../../env.js";
import { SensorsAggregateRepo } from "../sensors/sensors.aggregate.repo.js";
import { SensorsRepo } from "../sensors/sensors.repo.js";
import { SensorsService } from "../sensors/sensors.service.js";
import { createAssistantRoutes } from "./assistant.routes.js";
import { createProvider } from "./providers/factory.js";
import { GeminiEmbeddingProvider } from "../knowledge/embedding.js";
import { KnowledgeIndex } from "../knowledge/index-search.js";
import { KnowledgeService } from "../knowledge/service.js";
import { FileKnowledgeStore } from "../knowledge/store.js";
import { AnswerCache } from "./answer-cache.js";
import { pool } from "../../db/client.js";
import { createRateLimiter } from "./rate-limiter.js";
import { createSharedRateLimiter, PgHitStore, withFallback } from "./rate-store.js";
import { createKnowledgeTool } from "./tools/knowledge-tool.js";
import { ToolRegistry } from "./tools/registry.js";
import { createSensorTools, sensorToolDepsFrom } from "./tools/sensor-tools.js";

/** The production wiring: settings from the environment, the real sensor services behind the tools. */
export const assistantRoutes: FastifyPluginAsyncZod = async (app) => {
  const provider = createProvider(env, (event) => app.log.warn({ capacity: event }, "assistant model capacity"));
  if (env.ASSISTANT_ENABLED && !provider) {
    app.log.warn({ provider: env.ASSISTANT_PROVIDER }, "assistant is enabled but has no provider to use: it will report 503");
  }
  const tools = createSensorTools(sensorToolDepsFrom(new SensorsService(new SensorsRepo(app.db)), new SensorsAggregateRepo(app.db)));

  // The knowledge base: the index file is read once at start. Without a key the search still works by keywords.
  const indexPath = env.KNOWLEDGE_INDEX_PATH ?? fileURLToPath(new URL("../../../knowledge/index.json", import.meta.url));
  try {
    const index = new KnowledgeIndex(await new FileKnowledgeStore(indexPath).load());
    if (index.size > 0) {
      const embedder = env.GEMINI_API_KEY && index.model && index.dim ? new GeminiEmbeddingProvider({ apiKey: env.GEMINI_API_KEY, model: index.model, dim: index.dim }) : null;
      const service = new KnowledgeService(index, embedder, (error) => app.log.warn({ err: error }, "knowledge: the question could not be embedded, searching by keywords"));
      tools.push(createKnowledgeTool(service.search));
      app.log.info({ fragments: index.size, model: index.model, vectors: embedder !== null }, "knowledge base loaded");
    } else {
      app.log.warn({ indexPath }, "knowledge base is empty: search_knowledge is off");
    }
  } catch (error) {
    app.log.error({ err: error, indexPath }, "knowledge base failed to load: search_knowledge is off");
  }
  const registry = new ToolRegistry(tools);
  const limits = { perMinute: env.ASSISTANT_RATE_PER_MIN, perHour: env.ASSISTANT_RATE_PER_HOUR, globalPerMinute: env.ASSISTANT_RATE_GLOBAL_PER_MIN };
  const local = createRateLimiter(limits);
  const limiter =
    env.ASSISTANT_RATE_STORE === "postgres"
      ? withFallback(createSharedRateLimiter(new PgHitStore(pool), limits), local, (error) => app.log.error({ err: error }, "assistant rate limit: the shared store failed, counting in memory"))
      : local;
  await app.register(
    createAssistantRoutes({
      enabled: env.ASSISTANT_ENABLED,
      provider,
      registry,
      limiter,
      maxOutputTokens: env.ASSISTANT_MAX_OUTPUT_TOKENS,
      now: () => new Date(),
      pingMs: 15_000,
      cache: new AnswerCache({ ttlMs: env.ASSISTANT_CACHE_TTL_MIN * 60_000 }),
    }),
  );
};
