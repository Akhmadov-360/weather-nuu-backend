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
