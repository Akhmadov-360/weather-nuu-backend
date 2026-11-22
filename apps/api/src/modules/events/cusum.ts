export type ChangePoint = {
  /** Index where the change began: the last moment the cumulative sum was at zero. */
  start: number;
  /** Index where the sum crossed the threshold and the change was reported. */
  detected: number;
  direction: 1 | -1;
  /** Mean distance of the ten samples after `detected` from the trend that held before the change. */
  magnitude: number;
};

export type CusumOptions = {
  /** Noise of the series (see `estimateSigma`). The slack and the threshold are multiples of it. */
  sigma: number;
  /** Slack: a deviation under k·σ does not add to the sum. */
  k?: number;
  /** Threshold: a change is reported when the sum passes h·σ. */
  h?: number;
  /** Length of the "calm" stretch the baseline is taken from, in samples. */
  baselineWindow?: number;
  /** The most recent samples left out of the baseline, so that a change in progress does not drag it along. */
  baselineLag?: number;
  /** After a report, the next one is not looked for for this many samples. */
  cooldown?: number;
};

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The noise of a sensor from the median absolute deviation of its first differences: neighbouring samples
 * differ by noise, not by the slow movement of the room, and a median shrugs off the few real jumps.
 * For independent noise the difference has σ·√2, and MAD·1.4826 turns the deviation into a σ.
 */
export function estimateSigma(values: number[]): number {
  if (values.length < 3) return 0;
  const diffs = values.slice(1).map((v, i) => v - values[i]!);
  const centre = median(diffs);
  const mad = median(diffs.map((d) => Math.abs(d - centre)));
  return (mad * 1.4826) / Math.SQRT2;
}

/**
 * Where the series should be at index `at` if it keeps doing what it did over [from, to): a straight line
 * through that stretch, extended. A slow drift (the street warming through the day) is followed, so only a
 * quicker change leaves a residual.
 */
function trendBaseline(values: number[], from: number, to: number, at: number): number {
  const n = to - from;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = from; i < to; i++) {
    const x = i - from;
    const y = values[i]!;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const den = n * sxx - sx * sx;
  const slope = den === 0 ? 0 : (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;
  return intercept + slope * (at - from);
}

/**
 * Cumulative-sum change detection (formula (1) of the assistant document), two-sided:
 *   S⁺ₜ = max(0, S⁺ₜ₋₁ + (xₜ − μₜ − k·σ)),   S⁻ₜ = max(0, S⁻ₜ₋₁ + (μₜ − xₜ − k·σ)),
 * a signal when a sum passes h·σ. μₜ is a line fitted to a trailing stretch that ends `baselineLag` samples ago
 * and extended to now, so a slow drift is followed and a quicker change stands out.
 */
export function cusum(values: number[], options: CusumOptions): ChangePoint[] {
  const { sigma } = options;
  const k = options.k ?? 0.75;
  const h = options.h ?? 9;
  const window = options.baselineWindow ?? 60;
  const lag = options.baselineLag ?? 10;
  const cooldown = options.cooldown ?? 20;
  if (!(sigma > 0) || values.length < window + lag + 1) return [];

  const found: ChangePoint[] = [];
  let up = 0;
  let down = 0;
  let upSince = window + lag;
  let downSince = window + lag;
  let quietUntil = 0;

  for (let t = window + lag; t < values.length; t++) {
    const baseline = trendBaseline(values, t - lag - window, t - lag, t);
    const r = values[t]! - baseline;
    if (t < quietUntil) {
      up = 0;
      down = 0;
      upSince = t;
      downSince = t;
      continue;
    }
    const nextUp = Math.max(0, up + r - k * sigma);
    const nextDown = Math.max(0, down - r - k * sigma);
    if (up === 0) upSince = t;
    if (down === 0) downSince = t;
    up = nextUp;
    down = nextDown;

    if (up > h * sigma || down > h * sigma) {
      const direction = up > down ? 1 : -1;
      const start = direction === 1 ? upSince : downSince;
      // Size of the change: the next few samples against where the trend before the change would have been.
      const ahead = Math.min(values.length, t + 10);
      let sum = 0;
      for (let i = t; i < ahead; i++) sum += values[i]! - trendBaseline(values, start - lag - window, start - lag, i);
      found.push({ start, detected: t, direction, magnitude: sum / Math.max(1, ahead - t) });
      up = 0;
      down = 0;
      quietUntil = t + cooldown;
    }
  }
  return found;
}
