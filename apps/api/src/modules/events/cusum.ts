export type ChangePoint = {
  /** Index where the change began: the last moment the cumulative sum was at zero. */
  start: number;
  /** Index where the sum crossed the threshold and the change was reported. */
  detected: number;
  direction: 1 | -1;
  /** Value at `detected` minus the baseline before the change. */
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
 * Cumulative-sum change detection (formula (1) of the assistant document), two-sided:
 *   S⁺ₜ = max(0, S⁺ₜ₋₁ + (xₜ − μₜ − k·σ)),   S⁻ₜ = max(0, S⁻ₜ₋₁ + (μₜ − xₜ − k·σ)),
 * a signal when a sum passes h·σ. μₜ is the median of a trailing stretch that ends `baselineLag` samples ago,
 * so a slow drift is followed and a quicker change stands out.
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
    const baseline = median(values.slice(t - lag - window, t - lag));
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
      found.push({ start, detected: t, direction, magnitude: values[t]! - median(values.slice(Math.max(0, start - lag - window), Math.max(1, start - lag))) });
      up = 0;
      down = 0;
      quietUntil = t + cooldown;
    }
  }
  return found;
}
