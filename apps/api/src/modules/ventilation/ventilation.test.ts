import { describe, expect, it } from "vitest";
import { detectEvents } from "../events/detect.js";
import { SCHEDULE } from "../events/run-eval.js";
import { generateSeries, SYNTHETIC_LAMBDA } from "../events/synthetic.js";
import { combineLambda, weightedQuantile } from "./combine.js";
import { evaluateEstimation } from "./estimate-eval.js";
import { fitRelaxation, studentQuantile975 } from "./fit.js";
import { estimatesFromEvents, stretchAfter } from "./from-events.js";
import { equilibrium, etaOf, halfLifeHours, lambdaOf, predictWithoutSource, relax } from "./model.js";
import { OPEN_WINDOW_LAMBDA_PRIOR } from "./prior.js";
import { decayStretch } from "./synthetic.js";

describe("the model of the dust (formula 3)", () => {
  const room = { a: 6, p: 0.9, k: 0.5, source: 0 };

  it("takes λ = a + k and η = aP / (a + k)", () => {
    expect(lambdaOf(room)).toBe(6.5);
    expect(etaOf(room)).toBeCloseTo((6 * 0.9) / 6.5);
  });

  it("goes to the equilibrium (aP·C_out + S/V) / (a + k) and stays there", () => {
    expect(equilibrium(room, 20)).toBeCloseTo((6 * 0.9 * 20) / 6.5);
    expect(equilibrium({ ...room, source: 13 }, 20)).toBeCloseTo((6 * 0.9 * 20 + 13) / 6.5);
    const ceq = equilibrium(room, 20);
    expect(relax(ceq, ceq, 6.5, 3)).toBeCloseTo(ceq);
  });

  it("starts at C_0, ends at C_eq and halves the distance in ln 2 / λ", () => {
    expect(relax(60, 15, 6.5, 0)).toBe(60);
    expect(relax(60, 15, 6.5, 100)).toBeCloseTo(15);
    expect(relax(60, 15, 6.5, halfLifeHours(6.5))).toBeCloseTo(15 + 45 / 2);
  });

  it("predicts the room without a source with η·C_out as the equilibrium", () => {
    expect(predictWithoutSource(60, 0.8, 6.5, 10, 0)).toBe(60);
    expect(predictWithoutSource(60, 0.8, 6.5, 10, 50)).toBeCloseTo(8);
  });
});

describe("fitRelaxation", () => {
  it("recovers λ, C_0 and C_eq of a clean curve exactly", () => {
    const { t, c } = decayStretch({ lambda: 9, c0: 60, ceq: 15, hours: 0.25, noise: 0, seed: 1 });
    const r = fitRelaxation({ t, c });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lambda).toBeCloseTo(9, 3);
    expect(r.c0).toBeCloseTo(60, 3);
    expect(r.ceq).toBeCloseTo(15, 2);
  });

  it("also fits a rise (a stretch that goes up to the equilibrium)", () => {
    const { t, c } = decayStretch({ lambda: 5, c0: 10, ceq: 50, hours: 0.5, noise: 0.3, seed: 3 });
    const r = fitRelaxation({ t, c });
    expect(r.ok && Math.abs(r.lambda - 5) / 5 < 0.1).toBe(true);
  });

  it("does not depend on the start time of the stretch", () => {
    const { t, c } = decayStretch({ lambda: 7, c0: 60, ceq: 15, hours: 0.25, noise: 0.5, seed: 4 });
    const a = fitRelaxation({ t, c });
    const b = fitRelaxation({ t: t.map((x) => x + 123.4), c });
    expect(a.ok && b.ok && Math.abs(a.lambda - b.lambda) < 1e-6).toBe(true);
  });

  it("refuses a stretch that is too short, flat, or too noisy to show a decay", () => {
    expect(fitRelaxation({ t: [0, 0.1, 0.2], c: [50, 40, 30] })).toEqual({ ok: false, reason: "too_few_points" });
    const flat = fitRelaxation({ t: Array.from({ length: 20 }, (_, i) => i / 60), c: Array.from({ length: 20 }, () => 30) });
    expect(flat.ok).toBe(false);
    const noise = decayStretch({ lambda: 9, c0: 31, ceq: 30, hours: 0.2, noise: 2, seed: 5 });
    expect(fitRelaxation(noise).ok).toBe(false);
  });

  it("gives an interval that is wider for a shorter or noisier stretch", () => {
    const width = (minutes: number, noise: number) => {
      const { t, c } = decayStretch({ lambda: 6, c0: 60, ceq: 15, hours: minutes / 60, noise, seed: 6 });
      const r = fitRelaxation({ t, c });
      return r.ok ? r.lambdaCi[1] - r.lambdaCi[0] : NaN;
    };
    expect(width(10, 1)).toBeGreaterThan(width(30, 1));
    expect(width(20, 2)).toBeGreaterThan(width(20, 0.5));
  });

  it("uses the Student quantile for few degrees of freedom and the normal one for many", () => {
    expect(studentQuantile975(1)).toBeCloseTo(12.706);
    expect(studentQuantile975(10)).toBeCloseTo(2.228);
    expect(studentQuantile975(500)).toBe(1.96);
  });
});

describe("the estimation judged on stretches with a known λ (the table recovered / true)", () => {
  const rows = evaluateEstimation({ lambdas: [5, 9, 15], noises: [0.5, 1], minutes: [15, 30], runs: 120 });

  it("answers on every stretch of that kind", () => {
    for (const r of rows) expect(r.okShare, `λ ${r.lambda} noise ${r.noise} ${r.minutes} min`).toBeGreaterThan(0.95);
  });

  it("has no bias and an error of a few percent where the stretch covers the decay", () => {
    for (const r of rows.filter((x) => x.minutes === 30 || x.lambda >= 9)) {
      expect(Math.abs(r.bias), `bias λ ${r.lambda} noise ${r.noise} ${r.minutes} min`).toBeLessThan(0.05);
      expect(r.medianRelError, `error λ ${r.lambda} noise ${r.noise} ${r.minutes} min`).toBeLessThan(0.15);
    }
  });

  it("gives intervals that contain the truth about as often as they promise (95 %)", () => {
    for (const r of rows) {
      expect(r.coverage, `coverage λ ${r.lambda} noise ${r.noise} ${r.minutes} min`).toBeGreaterThan(0.88);
      expect(r.coverage).toBeLessThan(1);
    }
  });
});

describe("combineLambda", () => {
  const prior = 5;

  it("takes the weighted median, so a sure estimate outweighs unsure ones", () => {
    const c = combineLambda(
      [
        { lambda: 8, se: 0.5 },
        { lambda: 9, se: 0.5 },
        { lambda: 9.5, se: 0.6 },
        { lambda: 2, se: 0.9 },
        { lambda: 20, se: 12 },
      ],
      { prior },
    );
    expect(c.source).toBe("data");
    expect(c.lambda).toBeGreaterThan(7.5);
    expect(c.lambda).toBeLessThan(10);
    expect(c.used).toBe(4);
    expect(c.spread![0]).toBeLessThanOrEqual(c.lambda);
    expect(c.spread![1]).toBeGreaterThanOrEqual(c.lambda);
  });

  it("returns the literature value, marked, when there are too few reliable stretches", () => {
    expect(combineLambda([], { prior })).toEqual({ lambda: 5, source: "prior", used: 0, spread: null });
    const noisy = combineLambda([{ lambda: 9, se: 0.5 }, { lambda: 3, se: 6 }, { lambda: 8, se: 7 }], { prior });
    expect(noisy.source).toBe("prior");
    expect(noisy.used).toBe(1);
  });

  it("ignores estimates that are not numbers or not positive", () => {
    const c = combineLambda([{ lambda: NaN, se: 1 }, { lambda: -3, se: 1 }, { lambda: 9, se: 0 }], { prior });
    expect(c.source).toBe("prior");
  });

  it("finds weighted quantiles", () => {
    expect(weightedQuantile([1, 2, 3], [1, 1, 1], 0.5)).toBe(2);
    expect(weightedQuantile([1, 2, 3], [10, 1, 1], 0.5)).toBe(1);
  });
});

describe("the whole way on the synthetic room: events of link 1, then λ_open", () => {
  const estimates: { lambda: number; se: number }[] = [];
  for (let seed = 1; seed <= 8; seed++) {
    const { samples } = generateSeries({ seed, days: 14 });
    estimates.push(...estimatesFromEvents(samples, detectEvents(samples, SCHEDULE)));
  }

  it("finds the open-window speed of the room within a quarter of the truth", () => {
    const c = combineLambda(estimates, { prior: OPEN_WINDOW_LAMBDA_PRIOR.value });
    expect(c.source).toBe("data");
    expect(Math.abs(c.lambda - SYNTHETIC_LAMBDA.open) / SYNTHETIC_LAMBDA.open).toBeLessThan(0.25);
    expect(c.used).toBeGreaterThan(20);
  });

  it("cuts the stretch of a ventilation where the dust stops falling, and refuses a start without a stretch", () => {
    const { samples, truth } = generateSeries({ seed: 5, days: 3 });
    const e = truth.find((x) => x.cls === "ventilation")!;
    const s = stretchAfter(samples, e.startMin)!;
    expect(s.t[0]).toBe(0);
    expect(s.t.length).toBeGreaterThan(5);
    expect(s.t.length).toBeLessThanOrEqual(21);
    expect(stretchAfter(samples, samples.length + 100)).toBeNull();
  });
});

describe("the value of the literature", () => {
  it("says that it is not backed by a source yet", () => {
    expect(OPEN_WINDOW_LAMBDA_PRIOR.verified).toBe(false);
    expect(OPEN_WINDOW_LAMBDA_PRIOR.value).toBeGreaterThan(0);
  });
});
