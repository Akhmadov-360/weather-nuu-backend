import { describe, expect, it } from "vitest";
import { cusum, estimateSigma, median } from "./cusum.js";
import { mulberry32 } from "./synthetic.js";

function noisy(n: number, sigma: number, seed = 1, level = 10): number[] {
  const rand = mulberry32(seed);
  return Array.from({ length: n }, () => level + (rand() + rand() + rand() + rand() - 2) * sigma * 1.73);
}

describe("median", () => {
  it("takes the middle value of an odd and the mean of the middle two of an even list", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("estimateSigma", () => {
  it("finds the noise of the sensor, not the slow movement of the room", () => {
    const rand = mulberry32(2);
    const slow = Array.from({ length: 600 }, (_, i) => 20 + i * 0.01 + (rand() - 0.5) * 0.6);
    const sigma = estimateSigma(slow);
    expect(sigma).toBeGreaterThan(0.12);
    expect(sigma).toBeLessThan(0.3);
  });

  it("is not thrown off by a few big jumps", () => {
    const values = noisy(600, 0.5);
    const clean = estimateSigma(values);
    const jumpy = values.map((v, i) => (i === 100 || i === 400 ? v + 50 : v));
    expect(Math.abs(estimateSigma(jumpy) - clean)).toBeLessThan(0.1);
  });
});

describe("cusum", () => {
  const options = { sigma: 0.5 };

  it("stays quiet on noise alone", () => {
    expect(cusum(noisy(1500, 0.5), options)).toEqual([]);
  });

  it("finds a step up, with the direction and a start close to the real one", () => {
    const values = noisy(300, 0.5).map((v, i) => (i >= 150 ? v + 5 : v));
    const found = cusum(values, options);
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found[0]!.direction).toBe(1);
    expect(Math.abs(found[0]!.start - 150)).toBeLessThanOrEqual(3);
    expect(found[0]!.detected).toBeGreaterThanOrEqual(150);
    expect(found[0]!.detected - 150).toBeLessThanOrEqual(5);
  });

  it("finds a step down", () => {
    const values = noisy(300, 0.5).map((v, i) => (i >= 150 ? v - 5 : v));
    const found = cusum(values, options);
    expect(found[0]!.direction).toBe(-1);
    expect(Math.abs(found[0]!.start - 150)).toBeLessThanOrEqual(3);
  });

  it("finds a slow ramp that is far smaller than the noise from one minute to the next", () => {
    const values = noisy(400, 0.3).map((v, i) => (i >= 200 ? v + Math.min(0.06 * (i - 200), 1.8) : v));
    const found = cusum(values, { sigma: 0.3 });
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found[0]!.direction).toBe(1);
    expect(found[0]!.start).toBeGreaterThan(190);
    expect(found[0]!.start).toBeLessThan(240);
  });

  it("does not flag a slow drift that the baseline can follow", () => {
    const values = noisy(1500, 0.5).map((v, i) => v + i * 0.001);
    expect(cusum(values, options)).toEqual([]);
  });

  it("does not report the same change again at once, but may report a separate one later", () => {
    const values = noisy(600, 0.5).map((v, i) => (i >= 150 ? v + 5 : v) + (i >= 450 ? 6 : 0));
    const found = cusum(values, options);
    const near150 = found.filter((c) => c.start > 140 && c.start < 175);
    const near450 = found.filter((c) => c.start > 440 && c.start < 475);
    expect(near150.length).toBeGreaterThanOrEqual(1);
    expect(near450.length).toBeGreaterThanOrEqual(1);
  });

  it("reports the size of the change", () => {
    const values = noisy(300, 0.5).map((v, i) => (i >= 150 ? v + 5 : v));
    expect(Math.abs(cusum(values, options)[0]!.magnitude - 5)).toBeLessThan(2);
  });

  it("returns nothing for a series that is too short to have a baseline", () => {
    expect(cusum([1, 2, 3], options)).toEqual([]);
  });
});
