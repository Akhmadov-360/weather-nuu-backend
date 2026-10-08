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
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
