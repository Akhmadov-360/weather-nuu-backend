export type GridRange = { fromMs: number; toMs: number; stepMs: number };

export type GridPoint = { t: number; v: number | null };

function validate({ fromMs, toMs, stepMs }: GridRange): number {
  if (!Number.isInteger(stepMs) || stepMs <= 0) throw new RangeError(`stepMs must be a positive integer, got ${stepMs}`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    throw new RangeError(`the range must be finite with toMs > fromMs, got ${fromMs}..${toMs}`);
  }
  return Math.ceil((toMs - fromMs) / stepMs);
}

/** Start time of every step of the range; a partial last step still counts. */
export function gridTimes(range: GridRange): number[] {
  const count = validate(range);
  return Array.from({ length: count }, (_, i) => range.fromMs + i * range.stepMs);
}

/**
 * Puts readings onto a regular grid: step i covers [fromMs + i·stepMs, fromMs + (i+1)·stepMs).
 * A step with no usable reading is `null`, never zero; `null` and NaN inputs are no reading.
 * Several readings in one step are averaged (or the last one kept). Points outside the range
 * are ignored and the input order does not matter.
 */
export function toRegularGrid(
  points: readonly GridPoint[],
  range: GridRange & { aggregate?: "mean" | "last" },
): (number | null)[] {
  const count = validate(range);
  const { fromMs, toMs, stepMs, aggregate = "mean" } = range;
  const sums = new Array<number>(count).fill(0);
  const counts = new Array<number>(count).fill(0);
  const lastAt = new Array<number>(count).fill(Number.NEGATIVE_INFINITY);
  const lastValue = new Array<number>(count).fill(0);

  for (const { t, v } of points) {
    if (v === null || !Number.isFinite(v) || t < fromMs || t >= toMs) continue;
    const i = Math.floor((t - fromMs) / stepMs);
    sums[i]! += v;
    counts[i]! += 1;
    if (t >= lastAt[i]!) {
      lastAt[i] = t;
      lastValue[i] = v;
    }
  }

  return sums.map((sum, i) => {
    if (counts[i] === 0) return null;
    return aggregate === "last" ? lastValue[i]! : sum / counts[i]!;
  });
}

/**
 * Fills runs of `null` no longer than `maxGapSteps` by straight-line interpolation between the
 * values on both sides. Longer runs and the edges of the series stay `null`: a long silence is
 * not invented away. `filled[i]` says which values were made up, so a chart or a report can say so.
 */
export function fillShortGaps(
  values: readonly (number | null)[],
  maxGapSteps: number,
): { values: (number | null)[]; filled: boolean[] } {
  const out = [...values];
  const filled = new Array<boolean>(values.length).fill(false);

  let i = 0;
  while (i < out.length) {
    if (out[i] !== null) {
      i++;
      continue;
    }
    let end = i;
    while (end < out.length && out[end] === null) end++;
    const length = end - i;
    const before = i > 0 ? out[i - 1] : null;
    const after = end < out.length ? out[end] : null;
    if (before !== null && before !== undefined && after !== null && after !== undefined && length <= maxGapSteps) {
      for (let k = 0; k < length; k++) {
        out[i + k] = before + ((after - before) * (k + 1)) / (length + 1);
        filled[i + k] = true;
      }
    }
    i = end;
  }
  return { values: out, filled };
}
