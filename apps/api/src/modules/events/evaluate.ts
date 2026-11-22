import type { DetectedEvent } from "./detect.js";
import type { EventClass, TruthEvent } from "./synthetic.js";

export type ClassScore = {
  cls: EventClass;
  truth: number;
  detected: number;
  matched: number;
  recall: number;
  precision: number;
  /** Median |detected start - real start| over matched events, minutes. */
  medianErrorMin: number;
};

export const EVENT_CLASSES: EventClass[] = ["ventilation", "class_start", "class_end", "cleaning", "ac"];

/**
 * Compares detected events with the events that were inserted. An event counts as found when one of the same
 * class begins within the tolerance of the real start (20 min, 30 for lessons); one detection is used for one real event only.
 */
/** People warm the room over tens of minutes, so lessons get a wider window than a window or a cleaning. */
const TOLERANCE: Record<EventClass, number> = { ventilation: 20, cleaning: 20, ac: 20, class_start: 30, class_end: 30 };

export function evaluate(truth: TruthEvent[], found: DetectedEvent[], tolerance: Partial<Record<EventClass, number>> = {}): ClassScore[] {
  return EVENT_CLASSES.map((cls) => {
    const real = truth.filter((e) => e.cls === cls);
    const mine = found.filter((e) => e.cls === cls);
    const toleranceMin = tolerance[cls] ?? TOLERANCE[cls];
    const used = new Set<number>();
    const errors: number[] = [];
    for (const r of real) {
      let best = -1;
      let bestError = Infinity;
      mine.forEach((m, i) => {
        const err = Math.abs(m.startMin - r.startMin);
        if (!used.has(i) && err <= toleranceMin && err < bestError) {
          best = i;
          bestError = err;
        }
      });
      if (best >= 0) {
        used.add(best);
        errors.push(bestError);
      }
    }
    errors.sort((a, b) => a - b);
    const matched = errors.length;
    return {
      cls,
      truth: real.length,
      detected: mine.length,
      matched,
      recall: real.length ? matched / real.length : 1,
      precision: mine.length ? matched / mine.length : 1,
      medianErrorMin: matched ? errors[Math.floor(matched / 2)]! : NaN,
    };
  });
}

/** Adds up the scores of several series (one per seed). */
export function combine(scores: ClassScore[][]): ClassScore[] {
  return EVENT_CLASSES.map((cls) => {
    const rows = scores.map((s) => s.find((r) => r.cls === cls)!);
    const truth = rows.reduce((a, r) => a + r.truth, 0);
    const detected = rows.reduce((a, r) => a + r.detected, 0);
    const matched = rows.reduce((a, r) => a + r.matched, 0);
    const errors = rows
      .filter((r) => r.matched)
      .map((r) => r.medianErrorMin)
      .sort((a, b) => a - b);
    return {
      cls,
      truth,
      detected,
      matched,
      recall: truth ? matched / truth : 1,
      precision: detected ? matched / detected : 1,
      medianErrorMin: errors.length ? errors[Math.floor(errors.length / 2)]! : NaN,
    };
  });
}
