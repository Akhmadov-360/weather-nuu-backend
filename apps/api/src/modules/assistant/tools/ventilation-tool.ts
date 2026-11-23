import { z } from "zod";
import type { VentilationAdvice } from "@weather/contracts";
import { defineTool, type Tool } from "./registry.js";

/**
 * The advice on opening the window of the auditorium. For the model it says in words where each number comes from, because
 * two of them are not measured here: the dust outside is a model estimate (the Street kit has no dust sensor), and the speed
 * of air exchange may be a literature value.
 */
export function createVentilationTool(advice: () => Promise<VentilationAdvice>): Tool {
  return defineTool({
    name: "get_ventilation_advice",
    description:
      "Advice on whether to open the window of the auditorium now: the verdict (open, do not open, wait, not needed, unknown), the reason, the dust inside, the dust outside and the dust expected inside in 15 minutes if the window is opened. Use it for questions like \"should I open the window\", \"is it worth ventilating now\".",
    schema: z.object({}),
    handler: async () => {
      const a = await advice();
      const notes = [
        "The dust outside is a MODEL estimate (CAMS through Open-Meteo, a grid of about 11 km), not a measurement: the Street kit has no dust sensor. Say \"according to the model\".",
        "The expected dust after the window is opened is an estimate, not a promise.",
      ];
      if (a.lambda.source === "prior") notes.push("The speed of air exchange is a literature value that has not been measured in this room; say that the estimate is approximate.");
      if (!a.lambda.verified && a.lambda.source === "prior") notes.push("That literature value has no checked source yet.");
      if (a.verdict === "unknown") notes.push("There is not enough data for advice: say that plainly and do not guess.");
      return {
        verdict: a.verdict,
        reason: a.reason,
        dustInsideNow: a.inside?.pm25 ?? null,
        dustOutsideModel: a.outside?.pm25 ?? null,
        outsideTemperatureC: a.outsideTemp,
        expectedDustInsideAfterMinutes: a.horizonMinutes,
        expectedDustInside: a.predicted,
        expectedRange: a.predictedRange,
        outsideForecastModel: a.forecast,
        airExchangeSource: a.lambda.source,
        notes,
      };
    },
  });
}
