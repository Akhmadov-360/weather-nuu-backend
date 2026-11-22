import { describe, expect, it } from "vitest";
import { generateSeries, mulberry32, type Sample, type TruthEvent } from "./synthetic.js";

const DAY = 1440;

function window(samples: Sample[], from: number, to: number): Sample[] {
  return samples.filter((s) => s.t >= from && s.t < to);
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pick = (events: TruthEvent[], cls: TruthEvent["cls"]) => events.filter((e) => e.cls === cls);

describe("generateSeries", () => {
  it("gives one sample per minute and no missing numbers", () => {
    const { samples } = generateSeries({ seed: 1, days: 2 });
    expect(samples).toHaveLength(2 * DAY);
    expect(samples[0]!.t).toBe(0);
    expect(samples.at(-1)!.t).toBe(2 * DAY - 1);
    for (const s of samples) for (const v of [s.temp, s.hum, s.pm25, s.outTemp, s.outHum]) expect(Number.isFinite(v)).toBe(true);
  });

  it("is the same for the same seed and different for another", () => {
    const a = generateSeries({ seed: 7, days: 1 });
    const b = generateSeries({ seed: 7, days: 1 });
    const c = generateSeries({ seed: 8, days: 1 });
    expect(a).toEqual(b);
    expect(a.samples.map((s) => s.pm25)).not.toEqual(c.samples.map((s) => s.pm25));
  });

  it("keeps the readings in a believable range", () => {
    const { samples } = generateSeries({ seed: 3, days: 5 });
    for (const s of samples) {
      expect(s.temp).toBeGreaterThan(5);
      expect(s.temp).toBeLessThan(35);
      expect(s.hum).toBeGreaterThan(10);
      expect(s.hum).toBeLessThan(95);
      expect(s.pm25).toBeGreaterThan(0);
      expect(s.pm25).toBeLessThan(400);
    }
  });

  it("writes down every inserted event with its class and time, in order, and they do not overlap", () => {
    const { truth } = generateSeries({ seed: 4, days: 6 });
    expect(truth.length).toBeGreaterThan(20);
    const classes = new Set(truth.map((e) => e.cls));
    for (const cls of ["ventilation", "cleaning", "ac", "class_start", "class_end"] as const) expect(classes.has(cls), cls).toBe(true);
    const sorted = [...truth].sort((a, b) => a.startMin - b.startMin);
    expect(truth).toEqual(sorted);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.startMin, `${sorted[i - 1]!.cls} then ${sorted[i]!.cls}`).toBeGreaterThanOrEqual(sorted[i - 1]!.startMin);
    }
    for (const e of truth) expect(e.endMin).toBeGreaterThan(e.startMin);
  });

  it("makes an open window drop the dust quickly while the street is cleaner, and the street's air get in", () => {
    const { samples, truth } = generateSeries({ seed: 5, days: 8 });
    const events = pick(truth, "ventilation");
    expect(events.length).toBeGreaterThan(5);
    for (const e of events) {
      const before = mean(window(samples, e.startMin - 8, e.startMin).map((s) => s.pm25));
      const after = mean(window(samples, e.endMin - 3, e.endMin + 1).map((s) => s.pm25));
      expect(after, `ventilation at minute ${e.startMin}`).toBeLessThan(before * 0.85);
    }
  });

  it("makes cleaning a short rise of the dust and nothing else", () => {
    const { samples, truth } = generateSeries({ seed: 6, days: 8 });
    const events = pick(truth, "cleaning");
    expect(events.length).toBeGreaterThan(3);
    for (const e of events) {
      const before = mean(window(samples, e.startMin - 8, e.startMin).map((s) => s.pm25));
      const peak = Math.max(...window(samples, e.startMin, e.endMin + 6).map((s) => s.pm25));
      expect(peak, `cleaning at minute ${e.startMin}`).toBeGreaterThan(before * 1.25);
      const t0 = mean(window(samples, e.startMin - 8, e.startMin).map((s) => s.temp));
      const t1 = mean(window(samples, e.endMin, e.endMin + 6).map((s) => s.temp));
      expect(Math.abs(t1 - t0)).toBeLessThan(0.6);
    }
  });

  it("makes the air conditioner change the temperature and the humidity together while the dust stays", () => {
    const { samples, truth } = generateSeries({ seed: 9, days: 8 });
    const events = pick(truth, "ac");
    expect(events.length).toBeGreaterThan(3);
    for (const e of events) {
      const t0 = mean(window(samples, e.startMin - 6, e.startMin).map((s) => s.temp));
      const t1 = mean(window(samples, e.startMin + 15, e.startMin + 20).map((s) => s.temp));
      const h0 = mean(window(samples, e.startMin - 6, e.startMin).map((s) => s.hum));
      const h1 = mean(window(samples, e.startMin + 15, e.startMin + 20).map((s) => s.hum));
      const p0 = mean(window(samples, e.startMin - 6, e.startMin).map((s) => s.pm25));
      const p1 = mean(window(samples, e.startMin + 15, e.startMin + 20).map((s) => s.pm25));
      expect(t0 - t1, `temperature at ${e.startMin}`).toBeGreaterThan(1.5);
      expect(h0 - h1, `humidity at ${e.startMin}`).toBeGreaterThan(2);
      expect(Math.abs(p1 - p0) / p0, `dust at ${e.startMin}`).toBeLessThan(0.2);
    }
  });

  it("brings people in at the start of a lesson: a slow rise of the temperature and the humidity", () => {
    const { samples, truth } = generateSeries({ seed: 10, days: 6 });
    const events = pick(truth, "class_start");
    expect(events.length).toBeGreaterThan(4);
    for (const e of events) {
      const t0 = mean(window(samples, e.startMin - 6, e.startMin).map((s) => s.temp));
      const t1 = mean(window(samples, e.startMin + 25, e.startMin + 30).map((s) => s.temp));
      expect(t1 - t0, `lesson at ${e.startMin}`).toBeGreaterThan(0.25);
    }
  });
});

describe("mulberry32", () => {
  it("repeats for a seed and stays in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
