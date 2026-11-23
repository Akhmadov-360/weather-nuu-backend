import { mulberry32 } from "../events/synthetic.js";
import { relax } from "./model.js";

function gauss(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());
}

/**
 * A stretch of dust readings that follows formula (3) with a KNOWN speed λ and equilibrium, plus noise of the
 * sensor: the stretch with a known answer on which the estimation is judged (docs/features/SMART_ASSISTANT.md,
 * "Проверка метода оценки"). `step` is the interval between readings in hours (a reading every minute: 1/60).
 */
export function decayStretch(options: { lambda: number; c0: number; ceq: number; hours: number; stepHours?: number; noise: number; seed: number }): { t: number[]; c: number[] } {
  const rand = mulberry32(options.seed);
  const step = options.stepHours ?? 1 / 60;
  const t: number[] = [];
  const c: number[] = [];
  for (let x = 0; x <= options.hours + 1e-9; x += step) {
    t.push(x);
    c.push(Math.max(0, relax(options.c0, options.ceq, options.lambda, x) + gauss(rand) * options.noise));
  }
  return { t, c };
}
