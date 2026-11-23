import { relax } from "./model.js";

export type FitInput = {
  /** Time of each reading, hours from any start. */
  t: number[];
  /** Concentration at those times. */
  c: number[];
};

export type FitResult =
  | {
      ok: true;
      /** Speed of levelling off, 1/h. */
      lambda: number;
      /** Standard error of λ from the residuals. */
      lambdaSe: number;
      /** 95 % interval of λ (Student quantile for the number of degrees of freedom). */
      lambdaCi: [number, number];
      /** Start value and equilibrium of the fit, µg/m³. */
      c0: number;
      ceq: number;
      /** Standard deviation of the residuals, µg/m³. */
      sigma: number;
      n: number;
      iterations: number;
    }
  | { ok: false; reason: "too_few_points" | "no_decay" | "no_fit" | "implausible" };

/** λ outside these bounds is a failure of the fit, not a room: 0.05 per hour is a sealed box, 100 per hour is a fan. */
const LAMBDA_MIN = 0.05;
const LAMBDA_MAX = 100;
const MIN_POINTS = 6;

/** Two-sided 95 % Student quantiles for 1..30 degrees of freedom; beyond that, the normal 1.96. */
const T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
export const studentQuantile975 = (df: number): number => (df < 1 ? Infinity : (T975[df - 1] ?? 1.96));

/** Solves the 3x3 system A·x = b by Gauss elimination with a pivot; `null` when the matrix is singular. */
function solve3(a: number[][], b: number[]): number[] | null {
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    if (Math.abs(m[pivot]![col]!) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    for (let r = col + 1; r < 3; r++) {
      const f = m[r]![col]! / m[col]![col]!;
      for (let c = col; c < 4; c++) m[r]![c]! -= f * m[col]![c]!;
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = m[r]![3]!;
    for (let c = r + 1; c < 3; c++) s -= m[r]![c]! * x[c]!;
    x[r] = s / m[r]![r]!;
  }
  return x;
}

/** The element [i][i] of the inverse of a 3x3 matrix (the variance of the i-th parameter is σ² times it). */
function inverseDiagonal(a: number[][], i: number): number | null {
  const e = [0, 0, 0];
  e[i] = 1;
  const column = solve3(a, e);
  return column ? column[i]! : null;
}

function rss(t: number[], c: number[], c0: number, ceq: number, lambda: number): number {
  let s = 0;
  for (let i = 0; i < t.length; i++) s += (c[i]! - relax(c0, ceq, lambda, t[i]! - t[0]!)) ** 2;
  return s;
}

/**
 * Fits C(t) = C_eq + (C_0 − C_eq)·e^{−λt} to a stretch of readings by the nonlinear least squares (the method
 * of Gauss–Newton with the damping of Levenberg–Marquardt), and gives λ with its 95 % interval. Three unknowns:
 * the start C_0, the equilibrium C_eq and the speed λ. The outdoor level is not needed to find λ: it is hidden in
 * C_eq (= η·C_out plus what the room's own source adds), and η = C_eq / C_out follows when C_out is known.
 * The stretch must be one decay with no source starting in the middle of it (the events of link 1 give such stretches).
 */
export function fitRelaxation(input: FitInput): FitResult {
  const n = input.t.length;
  if (n < MIN_POINTS || input.c.length !== n) return { ok: false, reason: "too_few_points" };
  const t0 = input.t[0]!;
  const t = input.t.map((x) => x - t0);
  const c = input.c;
  if (!(t[n - 1]! > 0)) return { ok: false, reason: "too_few_points" };

  // Start: the first reading, the equilibrium from the tail of the stretch, λ from the line through the logarithms.
  const tail = c.slice(Math.floor(n * 0.8));
  let c0 = c[0]!;
  let ceq = tail.reduce((s, v) => s + v, 0) / tail.length;
  if (Math.abs(c0 - ceq) < 1e-6) return { ok: false, reason: "no_decay" };
  // Push the equilibrium beyond the last reading so that the logarithm exists for all of them.
  const direction = Math.sign(c0 - ceq);
  ceq -= direction * Math.max(1e-3, Math.abs(c0 - ceq) * 0.05);
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let m = 0;
  for (let i = 0; i < n; i++) {
    const d = (c[i]! - ceq) * direction;
    if (d <= 0) continue;
    const y = Math.log(d);
    sx += t[i]!;
    sy += y;
    sxx += t[i]! * t[i]!;
    sxy += t[i]! * y;
    m++;
  }
  let lambda = m >= 2 && m * sxx - sx * sx > 0 ? -(m * sxy - sx * sy) / (m * sxx - sx * sx) : 1 / t[n - 1]!;
  if (!(lambda > LAMBDA_MIN)) lambda = 1 / t[n - 1]!;
  lambda = Math.min(LAMBDA_MAX, Math.max(LAMBDA_MIN, lambda));

  let damping = 1e-3;
  let current = rss(t, c, c0, ceq, lambda);
  let iterations = 0;
  let jtj: number[][] = [];
  for (; iterations < 80; iterations++) {
    jtj = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const jtr = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const e = Math.exp(-lambda * t[i]!);
      const j = [e, 1 - e, -(c0 - ceq) * t[i]! * e];
      const r = c[i]! - relax(c0, ceq, lambda, t[i]!);
      for (let p = 0; p < 3; p++) {
        jtr[p]! += j[p]! * r;
        for (let q = 0; q < 3; q++) jtj[p]![q]! += j[p]! * j[q]!;
      }
    }
    let improved = false;
    for (let attempt = 0; attempt < 12 && !improved; attempt++) {
      const damped = jtj.map((row, p) => row.map((v, q) => (p === q ? v * (1 + damping) + 1e-12 : v)));
      const step = solve3(damped, jtr);
      if (!step) {
        damping *= 10;
        continue;
      }
      const next = { c0: c0 + step[0]!, ceq: ceq + step[1]!, lambda: lambda + step[2]! };
      if (next.lambda > 0 && Number.isFinite(next.lambda + next.c0 + next.ceq)) {
        const candidate = rss(t, c, next.c0, next.ceq, next.lambda);
        if (candidate < current) {
          const change = Math.abs(current - candidate) / (current + 1e-12);
          c0 = next.c0;
          ceq = next.ceq;
          lambda = next.lambda;
          current = candidate;
          damping = Math.max(1e-9, damping / 5);
          improved = true;
          if (change < 1e-10) iterations = 1e9;
        }
      }
      if (!improved) damping *= 10;
    }
    if (!improved) break;
  }

  if (!Number.isFinite(lambda) || lambda < LAMBDA_MIN || lambda > LAMBDA_MAX) return { ok: false, reason: "implausible" };
  const df = n - 3;
  const sigma = Math.sqrt(current / df);
  // No decay: the change over the stretch does not stand out of the noise.
  if (!(Math.abs(c0 - ceq) * (1 - Math.exp(-lambda * t[n - 1]!)) > 3 * sigma)) return { ok: false, reason: "no_decay" };

  const variance = inverseDiagonal(jtj, 2);
  if (variance === null || !(variance >= 0)) return { ok: false, reason: "no_fit" };
  const lambdaSe = sigma * Math.sqrt(variance);
  const half = studentQuantile975(df) * lambdaSe;
  return { ok: true, lambda, lambdaSe, lambdaCi: [lambda - half, lambda + half], c0, ceq, sigma, n, iterations: Math.min(iterations, 80) };
}
