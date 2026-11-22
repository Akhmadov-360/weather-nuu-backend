import type { AggregateBucketRow, SensorReading } from "@weather/contracts";
import type { KnowledgeSearch } from "../../knowledge/service.js";
import { createKnowledgeTool } from "../tools/knowledge-tool.js";
import { ToolRegistry } from "../tools/registry.js";
import { createSensorTools } from "../tools/sensor-tools.js";

/** Fixed time and fixed readings, so that a run depends on the model only. */
export const EVAL_NOW = new Date("2026-11-22T12:00:00.000Z");

const reading = (source: "room" | "street"): SensorReading => ({
  id: 1,
  source,
  hum: source === "room" ? 38.1 : 71.4,
  bmpPress: 962.6,
  mq5: 17,
  mq3: 1,
  fusedTemp: source === "room" ? 24.7 : 9.3,
  pm25: source === "room" ? 48.2 : null,
  pm10: source === "room" ? 60 : null,
  recordedAt: new Date(EVAL_NOW.getTime() - 20_000).toISOString(),
});

const stats = (avg: number | null, min = avg, max = avg) => ({ avg, min, max });
const bucket = (source: "room" | "street", at: Date): AggregateBucketRow => ({
  ts: at.toISOString(),
  count: 120,
  hum: source === "room" ? stats(39.2, 35.1, 44.6) : stats(70.3, 62.0, 80.4),
  press: stats(962.1, 960.8, 963.4),
  mq5: stats(17, 12, 22),
  mq3: stats(1, 0, 2),
  temp: source === "room" ? stats(23.8, 21.9, 25.4) : stats(8.6, 5.2, 12.7),
  pm25: source === "room" ? stats(41.5, 22.3, 77.9) : stats(null),
  pm10: source === "room" ? stats(52.8, 30.1, 95.2) : stats(null),
});

export function evalRegistry(knowledge?: KnowledgeSearch): ToolRegistry {
  const tools = createSensorTools({
    latest: async (source) => reading(source),
    aggregate: async ({ source, from }) => [bucket(source, from)],
  });
  if (knowledge) tools.push(createKnowledgeTool(knowledge));
  return new ToolRegistry(tools);
}
