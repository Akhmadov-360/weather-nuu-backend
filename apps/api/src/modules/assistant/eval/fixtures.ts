import type { AggregateBucketRow, SensorReading } from "@weather/contracts";
import type { KnowledgeSearch } from "../../knowledge/service.js";
import { createEventsTool } from "../tools/events-tool.js";
import { createKnowledgeTool } from "../tools/knowledge-tool.js";
import { createVentilationTool } from "../tools/ventilation-tool.js";
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
  tools.push(
    createEventsTool(async (from, to) => ({
      from: from.toISOString(),
      to: to.toISOString(),
      events: [{ cls: "ventilation", start: "2026-11-22T09:26:00.000Z", detected: "2026-11-22T09:27:00.000Z", confirmedByStreet: true }],
      method: { name: "cusum-rules-v1", experimental: true, classes: ["ventilation", "cleaning", "ac"] },
      coverageMinutes: 340,
    })),
  );
  tools.push(
    createVentilationTool(async () => ({
      verdict: "open",
      reason: "outside_cleaner",
      computedAt: EVAL_NOW.toISOString(),
      inside: { pm25: 48.2, at: EVAL_NOW.toISOString() },
      outside: { pm25: 14.1, at: EVAL_NOW.toISOString(), kind: "model", source: "CAMS ENSEMBLE via Open-Meteo", attributionUrl: "https://open-meteo.com/" },
      outsideTemp: 9.3,
      horizonMinutes: 15,
      predicted: 17.6,
      predictedRange: [14.9, 24.3],
      gain: 30.6,
      waitHours: null,
      lambda: { value: 5, source: "prior", verified: false, range: null },
      forecast: [{ hours: 1, value: 18.9 }],
    })),
  );
  if (knowledge) tools.push(createKnowledgeTool(knowledge));
  return new ToolRegistry(tools);
}
