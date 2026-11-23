import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().url().or(z.string().startsWith("postgres")),
  PORT: z.coerce.number().int().positive().default(8001),
  HOST: z.string().default("0.0.0.0"),
  // No wildcard default — a missing value should fail startup, not
  // silently open the API to every origin (write endpoints have no other
  // access control, see INGEST_API_KEY).
  CORS_ORIGIN: z.string().min(1),
  // Shared secret devices must send as `x-api-key` on POST /v1/sensors/:source
  // and POST /v1/cansat. Generate with e.g. `openssl rand -hex 32`.
  INGEST_API_KEY: z.string().min(16),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // The assistant (chat). Off unless asked for. "true" is parsed explicitly: z.coerce.boolean would
  // turn the string "false" into true.
  ASSISTANT_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // Required when the assistant is on; "fake" is refused in production (see assertProviderAllowed).
  ASSISTANT_PROVIDER: z.enum(["fake", "gemini"]).optional(),
  // Secrets and model names live only in the server's .env, never in the repository.
  GEMINI_API_KEY: z.string().min(1).optional(),
  ASSISTANT_MODEL: z.string().min(1).optional(),
  // A second model that takes over while the first is out of quota (each model has its own quota).
  ASSISTANT_FALLBACK_MODEL: z.string().min(1).optional(),
  // Requests a day the key allows (the free tier of gemini-3.5-flash-lite: 500). Past it the model is not asked.
  ASSISTANT_DAILY_LIMIT: z.coerce.number().int().positive().optional(),
  ASSISTANT_FALLBACK_DAILY_LIMIT: z.coerce.number().int().positive().optional(),
  // How long an answer that does not depend on the readings is kept, minutes; 0 turns the cache off.
  ASSISTANT_CACHE_TTL_MIN: z.coerce.number().int().min(0).default(360),
  // Where the request counters live: in this process (one API process) or in PostgreSQL (several share them).
  ASSISTANT_RATE_STORE: z.enum(["memory", "postgres"]).default("memory"),
  // The lessons of the auditorium, local time ("13:30,15:10"): without them the events "start/end of a lesson" are not told.
  EVENTS_LESSON_STARTS: z.string().optional(),
  EVENTS_LESSON_ENDS: z.string().optional(),
  // Local time of the station against UTC, minutes (Tashkent: +5 h).
  EVENTS_UTC_OFFSET_MIN: z.coerce.number().int().min(-720).max(840).default(300),
  // The point of the station for the model dust outside (the campus of the university, Tashkent).
  OUTDOOR_LAT: z.coerce.number().min(-90).max(90).default(41.343),
  OUTDOOR_LON: z.coerce.number().min(-180).max(180).default(69.205),
  ASSISTANT_RATE_PER_MIN: z.coerce.number().int().positive().default(10),
  ASSISTANT_RATE_PER_HOUR: z.coerce.number().int().positive().default(60),
  // One ceiling for the whole service, under the free-tier quota of the model.
  ASSISTANT_RATE_GLOBAL_PER_MIN: z.coerce.number().int().positive().default(20),
  /** Where the knowledge index file is; by default apps/api/knowledge/index.json. */
  KNOWLEDGE_INDEX_PATH: z.string().min(1).optional(),
  ASSISTANT_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(600),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
