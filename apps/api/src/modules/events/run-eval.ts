import { detectEvents } from "./detect.js";
import { combine, evaluate, type ClassScore } from "./evaluate.js";
import { generateSeries } from "./synthetic.js";

/** The lessons of the synthetic auditorium, as minutes of the day (see synthetic.ts). */
export const SCHEDULE = { lessonStarts: [13 * 60 + 30], lessonEnds: [17 * 60 + 50] };

export function runEvaluation(seeds: number[], days: number, noise = 1): ClassScore[] {
  return combine(
    seeds.map((seed) => {
      const { samples, truth } = generateSeries({ seed, days, noise });
      return evaluate(truth, detectEvents(samples, SCHEDULE));
    }),
  );
}

export function formatTable(scores: ClassScore[]): string {
  const rows = scores.map(
    (s) =>
      `${s.cls.padEnd(12)} ${String(s.truth).padStart(5)} ${String(s.detected).padStart(8)} ${(s.recall * 100).toFixed(0).padStart(7)}% ${(s.precision * 100).toFixed(0).padStart(8)}% ${Number.isNaN(s.medianErrorMin) ? "     -" : s.medianErrorMin.toFixed(0).padStart(6)} min`,
  );
  return ["class         truth detected  recall precision  error", ...rows].join("\n");
}
