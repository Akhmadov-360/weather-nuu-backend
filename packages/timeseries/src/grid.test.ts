import { describe, expect, it } from "vitest";
import { fillShortGaps, gridTimes, toRegularGrid } from "./grid.js";

const H = 3_600_000;
const range = { fromMs: 0, toMs: 6 * H, stepMs: H };

describe("gridTimes", () => {
  it("lists the start of every step in the range", () => {
    expect(gridTimes(range)).toEqual([0, H, 2 * H, 3 * H, 4 * H, 5 * H]);
  });

  it("rounds a partial last step up", () => {
    expect(gridTimes({ fromMs: 0, toMs: 2.5 * H, stepMs: H })).toEqual([0, H, 2 * H]);
  });

  it.each([0, -1, Number.NaN, 1.5])("rejects step %s", (stepMs) => {
    expect(() => gridTimes({ fromMs: 0, toMs: H, stepMs })).toThrow();
  });

  it("rejects an empty or reversed range", () => {
    expect(() => gridTimes({ fromMs: H, toMs: H, stepMs: H })).toThrow();
    expect(() => gridTimes({ fromMs: 2 * H, toMs: H, stepMs: H })).toThrow();
  });
});

describe("toRegularGrid", () => {
  it("puts one point into the step that contains it and leaves the other steps null", () => {
    const out = toRegularGrid([{ t: 2 * H + 10, v: 7 }], range);
    expect(out).toEqual([null, null, 7, null, null, null]);
  });

  it("averages several points of the same step", () => {
    const out = toRegularGrid(
      [
        { t: H, v: 10 },
        { t: H + 1000, v: 20 },
      ],
      range,
    );
    expect(out[1]).toBe(15);
  });

  it("can keep the last point of a step instead", () => {
    const out = toRegularGrid(
      [
        { t: H, v: 10 },
        { t: H + 1000, v: 20 },
      ],
      { ...range, aggregate: "last" },
    );
    expect(out[1]).toBe(20);
  });

  it("works whatever the order of the input", () => {
    const out = toRegularGrid(
      [
        { t: 3 * H, v: 3 },
        { t: H, v: 1 },
      ],
      range,
    );
    expect(out).toEqual([null, 1, null, 3, null, null]);
  });

  it("treats null and NaN as no reading, and never as zero", () => {
    const out = toRegularGrid(
      [
        { t: 0, v: null },
        { t: H, v: Number.NaN },
        { t: 2 * H, v: 0 },
      ],
      range,
    );
    expect(out).toEqual([null, null, 0, null, null, null]);
  });

  it("ignores points before the start and from the end of the range on", () => {
    const out = toRegularGrid(
      [
        { t: -1, v: 1 },
        { t: 6 * H, v: 2 },
      ],
      range,
    );
    expect(out.every((v) => v === null)).toBe(true);
  });

  it("returns only nulls for an empty series", () => {
    expect(toRegularGrid([], range)).toEqual([null, null, null, null, null, null]);
  });
});

describe("fillShortGaps", () => {
  it("fills a short interior gap linearly and says which values were invented", () => {
    const out = fillShortGaps([1, null, null, 4], 3);
    expect(out.values).toEqual([1, 2, 3, 4]);
    expect(out.filled).toEqual([false, true, true, false]);
  });

  it("leaves a gap longer than the limit alone", () => {
    const out = fillShortGaps([1, null, null, null, null, null, 7], 3);
    expect(out.values).toEqual([1, null, null, null, null, null, 7]);
    expect(out.filled.some(Boolean)).toBe(false);
  });

  it("fills a gap exactly as long as the limit", () => {
    expect(fillShortGaps([0, null, null, null, 4], 3).values).toEqual([0, 1, 2, 3, 4]);
  });

  it("never fills at the edges, where there is nothing to interpolate towards", () => {
    expect(fillShortGaps([null, null, 5, null], 3).values).toEqual([null, null, 5, null]);
  });

  it("does not change its input", () => {
    const input = [1, null, 3];
    fillShortGaps(input, 3);
    expect(input).toEqual([1, null, 3]);
  });

  it("with a limit of 0 fills nothing", () => {
    expect(fillShortGaps([1, null, 3], 0).values).toEqual([1, null, 3]);
  });

  it("handles an empty series", () => {
    expect(fillShortGaps([], 3)).toEqual({ values: [], filled: [] });
  });
});
