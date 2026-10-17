import { describe, expect, it } from "vitest";
import { findGaps, gapBetween } from "./gap.js";

const MIN = 60_000;

describe("gapBetween", () => {
  it("is null when the distance does not exceed the threshold (exact threshold is not a gap)", () => {
    expect(gapBetween(0, 5 * MIN, { thresholdMs: 15 * MIN })).toBeNull();
    expect(gapBetween(0, 15 * MIN, { thresholdMs: 15 * MIN })).toBeNull();
  });

  it("describes a gap strictly beyond the threshold", () => {
    expect(gapBetween(0, 16 * MIN, { thresholdMs: 15 * MIN })).toEqual({
      fromMs: 0,
      toMs: 16 * MIN,
      durationMs: 16 * MIN,
      approxMissing: 0,
    });
  });

  it("estimates the lost readings from the threshold by default (what the export has always done)", () => {
    expect(gapBetween(0, 180 * MIN, { thresholdMs: 15 * MIN })?.approxMissing).toBe(11);
  });

  it("estimates the lost readings from the expected step when one is given", () => {
    // a reading every 5 s: 10 minutes of silence loses about 119 readings
    expect(gapBetween(0, 10 * MIN, { thresholdMs: MIN, expectedStepMs: 5_000 })?.approxMissing).toBe(119);
  });

  it("never reports a negative gap for out-of-order input", () => {
    expect(gapBetween(10 * MIN, 0, { thresholdMs: MIN })).toBeNull();
  });
});

describe("findGaps", () => {
  const opts = { thresholdMs: 15 * MIN };

  it("finds nothing in an empty or single-point series without a range", () => {
    expect(findGaps([], opts)).toEqual([]);
    expect(findGaps([0], opts)).toEqual([]);
  });

  it("finds a gap in the middle", () => {
    const gaps = findGaps([0, 5 * MIN, 200 * MIN, 205 * MIN], opts);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ fromMs: 5 * MIN, toMs: 200 * MIN, durationMs: 195 * MIN });
  });

  it("finds two separate gaps in order", () => {
    const gaps = findGaps([0, 100 * MIN, 105 * MIN, 400 * MIN], opts);
    expect(gaps.map((g) => [g.fromMs, g.toMs])).toEqual([
      [0, 100 * MIN],
      [105 * MIN, 400 * MIN],
    ]);
  });

  it("reports silence at the start and at the end of a requested range", () => {
    const gaps = findGaps([60 * MIN, 65 * MIN], { ...opts, fromMs: 0, toMs: 120 * MIN });
    expect(gaps.map((g) => [g.fromMs, g.toMs])).toEqual([
      [0, 60 * MIN],
      [65 * MIN, 120 * MIN],
    ]);
  });

  it("does not report a range edge closer than the threshold", () => {
    expect(findGaps([5 * MIN, 10 * MIN], { ...opts, fromMs: 0, toMs: 20 * MIN })).toEqual([]);
  });

  it("reports an empty series as one gap over the whole range", () => {
    const gaps = findGaps([], { ...opts, fromMs: 0, toMs: 60 * MIN });
    expect(gaps).toEqual([{ fromMs: 0, toMs: 60 * MIN, durationMs: 60 * MIN, approxMissing: 3 }]);
  });

  it("ignores points outside the requested range", () => {
    const gaps = findGaps([-500 * MIN, 30 * MIN, 900 * MIN], { ...opts, fromMs: 0, toMs: 60 * MIN });
    expect(gaps.map((g) => [g.fromMs, g.toMs])).toEqual([
      [0, 30 * MIN],
      [30 * MIN, 60 * MIN],
    ]);
  });
});
