export type LambdaEstimate = { lambda: number; se: number };

/** The value below which the share `q` (0..1) of the total weight lies; the values are taken in order. */
export function weightedQuantile(values: number[], weights: number[], q: number): number {
  const order = values.map((v, i) => ({ v, w: weights[i]! })).sort((a, b) => a.v - b.v);
  const total = order.reduce((s, x) => s + x.w, 0);
  let run = 0;
  for (const x of order) {
    run += x.w;
    if (run >= q * total - 1e-12) return x.v;
  }
  return order.at(-1)!.v;
}

export type CombinedLambda = {
  lambda: number;
  /** Where the number comes from: the readings, or the value of the literature (too few reliable stretches). */
  source: "data" | "prior";
  /** How many stretches stood behind the data value. */
  used: number;
  /** 10 % and 90 % of the estimates by weight, only for the data value. */
  spread: [number, number] | null;
};

/**
 * One λ_open from the estimates of many stretches: the weighted median, the weight 1/se² (a sure estimate counts
 * more). An estimate whose standard error is more than `maxRelativeSe` of its value is not used. When fewer than
 * `minReliable` stretches are left, the value of the literature is returned and marked as such: the advice must
 * not stand on one or two noisy curves.
 */
export function combineLambda(estimates: LambdaEstimate[], options: { prior: number; minReliable?: number; maxRelativeSe?: number }): CombinedLambda {
  const maxRel = options.maxRelativeSe ?? 0.5;
  const good = estimates.filter((e) => Number.isFinite(e.lambda) && e.lambda > 0 && e.se > 0 && e.se / e.lambda <= maxRel);
  if (good.length < (options.minReliable ?? 3)) return { lambda: options.prior, source: "prior", used: good.length, spread: null };
  const values = good.map((e) => e.lambda);
  const weights = good.map((e) => 1 / (e.se * e.se));
  return {
    lambda: weightedQuantile(values, weights, 0.5),
    source: "data",
    used: good.length,
    spread: [weightedQuantile(values, weights, 0.1), weightedQuantile(values, weights, 0.9)],
  };
}
