import { fitRelaxation } from "./fit.js";
import { decayStretch } from "./synthetic.js";

export type EstimateRow = {
  lambda: number;
  noise: number;
  minutes: number;
  runs: number;
  /** Share of the stretches on which the fit gave an answer. */
  okShare: number;
  /** Median of |λ̂ − λ| / λ over the answers. */
  medianRelError: number;
  /** Median of (λ̂ − λ) / λ: a negative number is an underestimate. */
  bias: number;
  /** Share of the 95 % intervals that contain the true λ (should be near 0.95). */
  coverage: number;
};

const median = (xs: number[]): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * "Recovered / true" for the estimation of λ: stretches by formula (3) with a known λ and noise, many seeds for each
 * combination, the estimate compared with the truth.
 */
export function evaluateEstimation(options: { lambdas: number[]; noises: number[]; minutes: number[]; runs: number; c0?: number; ceq?: number }): EstimateRow[] {
  const c0 = options.c0 ?? 60;
  const ceq = options.ceq ?? 15;
  const rows: EstimateRow[] = [];
  for (const lambda of options.lambdas) {
    for (const noise of options.noises) {
      for (const minutes of options.minutes) {
        const errors: number[] = [];
        const biases: number[] = [];
        let ok = 0;
        let covered = 0;
        for (let seed = 1; seed <= options.runs; seed++) {
          const { t, c } = decayStretch({ lambda, c0, ceq, hours: minutes / 60, noise, seed: seed * 7919 + minutes });
          const fit = fitRelaxation({ t, c });
          if (!fit.ok) continue;
          ok++;
          errors.push(Math.abs(fit.lambda - lambda) / lambda);
          biases.push((fit.lambda - lambda) / lambda);
          if (fit.lambdaCi[0] <= lambda && lambda <= fit.lambdaCi[1]) covered++;
        }
        rows.push({ lambda, noise, minutes, runs: options.runs, okShare: ok / options.runs, medianRelError: median(errors), bias: median(biases), coverage: ok ? covered / ok : NaN });
      }
    }
  }
  return rows;
}

export function formatEstimateTable(rows: EstimateRow[]): string {
  const pct = (x: number) => (Number.isNaN(x) ? "    -" : `${(x * 100).toFixed(0).padStart(4)}%`);
  const head = "λ true  noise  minutes   answered  median error      bias  95% CI covers";
  return [head, ...rows.map((r) => `${r.lambda.toFixed(1).padStart(6)}  ${r.noise.toFixed(1).padStart(5)}  ${String(r.minutes).padStart(7)}  ${pct(r.okShare).padStart(9)}  ${pct(r.medianRelError).padStart(12)}  ${pct(r.bias).padStart(8)}  ${pct(r.coverage).padStart(13)}`)].join("\n");
}
