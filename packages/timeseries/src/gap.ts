/** A stretch of time with no readings: strictly longer than the threshold between two neighbours. */
export type Gap = {
  fromMs: number;
  toMs: number;
  durationMs: number;
  /** Rough count of readings that should have arrived inside the gap. */
  approxMissing: number;
};

export type GapOptions = {
  /** A distance strictly greater than this is a gap; exactly the threshold is not. */
  thresholdMs: number;
  /**
   * How often a reading is expected, for the estimate of lost readings. Defaults to the
   * threshold, which is what the export has always used; analytics that know the real
   * cadence (about 5 s for the boards) should pass it.
   */
  expectedStepMs?: number;
};

/** The gap between two consecutive readings, or null when they are close enough (or out of order). */
export function gapBetween(prevMs: number, nextMs: number, { thresholdMs, expectedStepMs }: GapOptions): Gap | null {
  const durationMs = nextMs - prevMs;
  if (!(durationMs > thresholdMs)) return null;
  const step = expectedStepMs ?? thresholdMs;
  return {
    fromMs: prevMs,
    toMs: nextMs,
    durationMs,
    approxMissing: Math.max(0, Math.round(durationMs / step) - 1),
  };
}

export type FindGapsOptions = GapOptions & {
  /** With a range, silence at its start and end counts too, and an empty series is one gap. */
  fromMs?: number;
  toMs?: number;
};

/**
 * Gaps in a list of reading times (any order; sorted on a copy). With `fromMs` and `toMs`
 * only readings inside the range are considered and the range edges act as anchors.
 */
export function findGaps(timesMs: readonly number[], options: FindGapsOptions): Gap[] {
  const { fromMs, toMs } = options;
  const hasRange = fromMs !== undefined && toMs !== undefined;
  const inside = hasRange ? timesMs.filter((t) => t >= fromMs && t <= toMs) : [...timesMs];
  inside.sort((a, b) => a - b);
  const points = hasRange ? [fromMs, ...inside, toMs] : inside;

  const gaps: Gap[] = [];
  for (let i = 1; i < points.length; i++) {
    const gap = gapBetween(points[i - 1]!, points[i]!, options);
    if (gap) gaps.push(gap);
  }
  return gaps;
}
