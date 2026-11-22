import { describe, expect, it } from "vitest";
import { detectEvents } from "./detect.js";
import { combine, evaluate } from "./evaluate.js";
import { runEvaluation, SCHEDULE } from "./run-eval.js";
import { generateSeries } from "./synthetic.js";

const byClass = (scores: ReturnType<typeof runEvaluation>, cls: string) => scores.find((s) => s.cls === cls)!;

describe("detectEvents on synthetic series with known events", () => {
  const seeds = [1, 2, 3, 4, 5, 6];
  const scores = runEvaluation(seeds, 10);

  it("finds most cleanings, and almost nothing it reports is false", () => {
    const s = byClass(scores, "cleaning");
    expect(s.recall).toBeGreaterThan(0.85);
    expect(s.precision).toBeGreaterThan(0.7);
  });

  it("finds the lessons from the schedule and the room's reaction", () => {
    expect(byClass(scores, "class_start").recall).toBeGreaterThan(0.5);
    expect(byClass(scores, "class_start").precision).toBeGreaterThan(0.9);
    expect(byClass(scores, "class_end").recall).toBeGreaterThan(0.5);
    expect(byClass(scores, "class_end").precision).toBeGreaterThan(0.8);
  });

  it("reports an open window and a conditioner only when it is sure, and rarely wrongly", () => {
    for (const cls of ["ventilation", "ac"]) {
      const s = byClass(scores, cls);
      expect(s.recall, `${cls} recall`).toBeGreaterThan(0.35);
      expect(s.precision, `${cls} precision`).toBeGreaterThan(0.8);
    }
  });

  it("puts the start of an event close to the real one", () => {
    for (const s of scores) expect(s.medianErrorMin, s.cls).toBeLessThanOrEqual(12);
  });

  it("reports nothing in a quiet room with noise only", () => {
    const { samples } = generateSeries({ seed: 11, days: 1 });
    const quiet = samples.slice(0, 12 * 60).map((s) => ({ ...s }));
    expect(detectEvents(quiet, SCHEDULE).filter((e) => e.cls !== "ac" && e.cls !== "ventilation").length).toBeLessThanOrEqual(1);
  });

  it("does not call a change a lesson when no schedule is given", () => {
    const { samples } = generateSeries({ seed: 2, days: 4 });
    const found = detectEvents(samples);
    expect(found.some((e) => e.cls === "class_start" || e.cls === "class_end")).toBe(false);
  });

  it("reports the minute the change began no later than the minute it was found", () => {
    const { samples } = generateSeries({ seed: 3, days: 3 });
    for (const e of detectEvents(samples, SCHEDULE)) expect(e.detectedMin).toBeGreaterThanOrEqual(e.startMin);
  });
});

describe("evaluate", () => {
  const truth = [
    { cls: "cleaning" as const, startMin: 100, endMin: 106 },
    { cls: "cleaning" as const, startMin: 500, endMin: 506 },
    { cls: "ac" as const, startMin: 300, endMin: 360 },
  ];

  it("counts a detection within the tolerance, once, and a stray one against precision", () => {
    const found = [
      { cls: "cleaning" as const, startMin: 108, detectedMin: 110 },
      { cls: "cleaning" as const, startMin: 109, detectedMin: 112 },
      { cls: "cleaning" as const, startMin: 900, detectedMin: 902 },
    ];
    const s = evaluate(truth, found).find((r) => r.cls === "cleaning")!;
    expect(s.truth).toBe(2);
    expect(s.matched).toBe(1);
    expect(s.recall).toBe(0.5);
    expect(s.precision).toBeCloseTo(1 / 3);
    expect(s.medianErrorMin).toBe(8);
  });

  it("does not match a detection of another class", () => {
    const s = evaluate(truth, [{ cls: "ventilation" as const, startMin: 300, detectedMin: 305 }]);
    expect(s.find((r) => r.cls === "ac")!.matched).toBe(0);
    expect(s.find((r) => r.cls === "ventilation")!.precision).toBe(0);
  });

  it("adds series up by counts, not by averaging the ratios", () => {
    const a = evaluate(truth, [{ cls: "cleaning" as const, startMin: 100, detectedMin: 101 }]);
    const b = evaluate(truth, []);
    const both = combine([a, b]).find((r) => r.cls === "cleaning")!;
    expect(both.truth).toBe(4);
    expect(both.matched).toBe(1);
    expect(both.recall).toBe(0.25);
  });
});
