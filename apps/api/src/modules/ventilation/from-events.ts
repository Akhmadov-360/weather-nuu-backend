import type { DetectedEvent } from "../events/detect.js";
import type { Sample } from "../events/synthetic.js";
import { combineLambda, type CombinedLambda, type LambdaEstimate } from "./combine.js";
import { fitRelaxation } from "./fit.js";

/** The longest stretch after the start of a ventilation that is looked at, minutes. */
const MAX_STRETCH_MINUTES = 20;
/** A window that is closed again makes the dust rise: the stretch ends at the lowest smoothed value, a little after it. */
const SMOOTH = 3;

/** The dust readings of the stretch that begins at the start of a ventilation and ends when the dust stops falling. */
export function stretchAfter(samples: Sample[], startMin: number): { t: number[]; c: number[] } | null {
  const from = samples.findIndex((s) => s.t >= startMin);
  if (from < 0) return null;
  const window = samples.slice(from, from + MAX_STRETCH_MINUTES + 1);
  if (window.length < 6) return null;
  const smooth = window.map((_, i) => {
    const part = window.slice(Math.max(0, i - SMOOTH + 1), i + 1);
    return part.reduce((s, x) => s + x.pm25, 0) / part.length;
  });
  let lowest = SMOOTH;
  for (let i = SMOOTH; i < smooth.length; i++) if (smooth[i]! < smooth[lowest]!) lowest = i;
  const end = Math.min(window.length, lowest + 2);
  const used = window.slice(0, end);
  return { t: used.map((s) => (s.t - startMin) / 60), c: used.map((s) => s.pm25) };
}

/** λ of every ventilation that the detector found: a fit on the stretch after its start. */
export function estimatesFromEvents(samples: Sample[], events: DetectedEvent[]): LambdaEstimate[] {
  const out: LambdaEstimate[] = [];
  for (const e of events) {
    if (e.cls !== "ventilation") continue;
    const stretch = stretchAfter(samples, e.startMin);
    if (!stretch) continue;
    const fit = fitRelaxation(stretch);
    if (fit.ok) out.push({ lambda: fit.lambda, se: fit.lambdaSe });
  }
  return out;
}

export function lambdaFromEvents(samples: Sample[], events: DetectedEvent[], prior: number): CombinedLambda {
  return combineLambda(estimatesFromEvents(samples, events), { prior });
}
