import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VentilationAdviceSchema } from "./ventilation.js";

const example = JSON.parse(readFileSync(new URL("./ventilation.example.json", import.meta.url), "utf8")) as { advice: Record<string, unknown> };

describe("ventilation advice contract", () => {
  it("accepts the documented answer", () => {
    expect(VentilationAdviceSchema.safeParse(example.advice).success).toBe(true);
  });

  it("accepts an answer with no data inside or outside", () => {
    expect(VentilationAdviceSchema.safeParse({ ...example.advice, verdict: "unknown", reason: "no_outdoor_data", outside: null, predicted: null, predictedRange: null, gain: null, forecast: [] }).success).toBe(true);
  });

  it("says that the outdoor dust is a model: any other kind is refused", () => {
    const outside = example.advice.outside as object;
    expect(VentilationAdviceSchema.safeParse({ ...example.advice, outside: { ...outside, kind: "sensor" } }).success).toBe(false);
  });

  it("refuses an unknown verdict and a speed that is not positive", () => {
    expect(VentilationAdviceSchema.safeParse({ ...example.advice, verdict: "maybe" }).success).toBe(false);
    expect(VentilationAdviceSchema.safeParse({ ...example.advice, lambda: { value: 0, source: "data", verified: true, range: null } }).success).toBe(false);
  });
});
