import "dotenv/config";
import type { AggregateBucketRow, SensorReading } from "@weather/contracts";
import { runAgent } from "../modules/assistant/agent-loop.js";
import { buildSystemPrompt, exhaustedMessage } from "../modules/assistant/prompt.js";
import { GeminiChatProvider } from "../modules/assistant/providers/gemini.js";
import { ToolRegistry } from "../modules/assistant/tools/registry.js";
import { createSensorTools } from "../modules/assistant/tools/sensor-tools.js";

/**
 * A real question to the real model, with the real tools over made-up readings (no database needed):
 *   pnpm --filter @weather/api assistant:smoke "Какая температура в аудитории?"
 * Needs GEMINI_API_KEY and ASSISTANT_MODEL in apps/api/.env. The key is read from the environment and
 * never printed.
 */
const question = process.argv.slice(2).join(" ") || "Какая сейчас температура в аудитории и какой уровень пыли?";
const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.ASSISTANT_MODEL;
if (!apiKey || !model) {
  console.error("Set GEMINI_API_KEY and ASSISTANT_MODEL in apps/api/.env");
  process.exit(1);
}

const now = new Date();
const reading = (source: "room" | "street"): SensorReading => ({
  id: 1,
  source,
  hum: 38.1,
  bmpPress: 962.6,
  mq5: 17,
  mq3: 1,
  fusedTemp: source === "room" ? 24.7 : 9.3,
  pm25: source === "room" ? 48.2 : null,
  pm10: source === "room" ? 60 : null,
  recordedAt: new Date(now.getTime() - 20_000).toISOString(),
});
const stats = (v: number | null) => ({ avg: v, min: v, max: v });
const bucket = (): AggregateBucketRow => ({ ts: now.toISOString(), count: 100, hum: stats(38), press: stats(962), mq5: stats(17), mq3: stats(1), temp: stats(24), pm25: stats(48), pm10: stats(60) });

const registry = new ToolRegistry(createSensorTools({ latest: async (source) => reading(source), aggregate: async () => [bucket()] }));

const started = Date.now();
let text = "";
for await (const event of runAgent({
  provider: new GeminiChatProvider({ apiKey, model }),
  registry,
  system: buildSystemPrompt({ lang: "ru", context: "room", now }),
  history: [],
  message: question,
  maxOutputTokens: 600,
  exhaustedMessage: exhaustedMessage("ru"),
  signal: new AbortController().signal,
  ctx: { now },
})) {
  if (event.type === "text") text += event.delta;
  else console.log(`[${event.type}]`, JSON.stringify(event));
}
console.log(`\nQuestion: ${question}\nAnswer: ${text}\nTime: ${Date.now() - started} ms (model ${model})`);
