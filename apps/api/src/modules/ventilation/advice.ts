import { CATEGORY_IDS, categorize, getStandard, type CategoryId } from "@weather/air-quality";
import { predictWithoutSource } from "./model.js";

export type Verdict =
  /** The window should be opened: the dust inside will fall noticeably. */
  | "open"
  /** Do not open: the street is worse than the room, or too dirty, or too cold or hot. */
  | "dont_open"
  /** Not now, but the forecast promises a clean street within hours. */
  | "wait"
  /** The air inside is already good: there is nothing to improve. */
  | "not_needed"
  /** The dust of the street is not known, so there is nothing to compare with. */
  | "unknown";

export type Reason =
  | "outside_cleaner"
  | "outside_worse"
  | "outside_dirty"
  | "no_gain"
  | "comfort"
  | "already_good"
  | "forecast_better"
  | "no_outdoor_data";

export type AdviceInput = {
  /** Dust inside now, µg/m³. */
  inside: number;
  /** Dust outside now, µg/m³: `null` when nothing is known (the Street kit has no dust sensor). */
  outside: number | null;
  /** Temperature outside, °C (for comfort); `null` when unknown. */
  outsideTemp?: number | null;
  /** The speed of levelling off with the window open, 1/h, and the 95 % interval of it when it is known. */
  lambdaOpen: number;
  lambdaOpenRange?: [number, number] | null;
  /** Where lambdaOpen comes from: measured here, or the value of the literature. */
  lambdaSource: "data" | "prior";
  /** What the outdoor dust is expected to be in the next hours (the forecast of another module): hours ahead and µg/m³. */
  outsideForecast?: { hours: number; value: number }[];
};

export type AdviceSettings = {
  /** After how many minutes the effect of an open window is looked at. */
  horizonMinutes: number;
  /** The air inside must fall by at least this share of its value to open a closed window. */
  gainOn: number;
  /** An absolute floor of the gain to open, µg/m³: a fall of two units is noise. */
  minGain: number;
  /**
   * A window that is already open stays open until the street is worse than the room by more than this, µg/m³. The room
   * has then levelled off with the street, the gain left is within the noise of the sensor, and closing the window
   * would only let the dust of the room's own sources climb again and bring the advice back in ten minutes.
   */
  keepMargin: number;
  /** The street must not be dirtier than this category (the plan: "not worse than moderate"). */
  worstOutsideCategory: CategoryId;
  /** The street temperature outside which opening a window is not advised, °C. */
  comfortRange: [number, number];
  /** The advice does not change for this long, minutes, except to "do not open" when the street becomes bad. */
  minHoldMinutes: number;
};

export const DEFAULT_SETTINGS: AdviceSettings = {
  horizonMinutes: 15,
  gainOn: 0.2,
  minGain: 3,
  keepMargin: 1,
  worstOutsideCategory: "moderate",
  comfortRange: [-5, 35],
  minHoldMinutes: 10,
};

export type Advice = {
  verdict: Verdict;
  reason: Reason;
  /** The dust expected inside after the horizon with the window open (and the range from the interval of λ), µg/m³. */
  predicted: number | null;
  predictedRange: [number, number] | null;
  gain: number | null;
  horizonMinutes: number;
  lambdaSource: "data" | "prior";
};

export type AdviceState = { verdict: Verdict; since: number };

const rank = (c: CategoryId): number => CATEGORY_IDS.indexOf(c);

/** What the window would do: the room goes to the level of the street (η_open ≈ 1: with the window wide open P ≈ 1 and a ≫ k). */
function predict(input: AdviceInput, minutes: number, lambda: number): number {
  return predictWithoutSource(input.inside, 1, lambda, input.outside!, minutes / 60);
}

/**
 * The advice from the numbers of this moment (formula (3) with λ_open and η_open ≈ 1). `previous` makes it hysteretic:
 * a closed window is opened only for a real gain (`gainOn` of the inside value and `minGain`), an open window stays open until the street is worse (`keepMargin`).
 */
export function rawAdvice(input: AdviceInput, previous: Verdict | null, settings: AdviceSettings = DEFAULT_SETTINGS): Advice {
  const base = { horizonMinutes: settings.horizonMinutes, lambdaSource: input.lambdaSource };
  const none = { predicted: null, predictedRange: null, gain: null };
  const standard = getStandard();

  if (input.outside === null || !Number.isFinite(input.outside)) return { verdict: "unknown", reason: "no_outdoor_data", ...none, ...base };

  const insideCategory = categorize(standard, "pm25", input.inside);
  // The air inside is already good: there is nothing to improve.
  if (insideCategory === "good") return { verdict: "not_needed", reason: "already_good", ...none, ...base };

  const [minT, maxT] = settings.comfortRange;
  if (input.outsideTemp != null && (input.outsideTemp < minT || input.outsideTemp > maxT)) {
    return { verdict: "dont_open", reason: "comfort", ...none, ...base };
  }

  const outsideCategory = categorize(standard, "pm25", input.outside);
  const predicted = predict(input, settings.horizonMinutes, input.lambdaOpen);
  const range: [number, number] | null = input.lambdaOpenRange
    ? [predict(input, settings.horizonMinutes, input.lambdaOpenRange[1]), predict(input, settings.horizonMinutes, input.lambdaOpenRange[0])]
    : null;
  const gain = input.inside - predicted;
  const numbers = { predicted, predictedRange: range, gain };

  // The street is worse than the room, or dirtier than the limit: opening only makes it worse.
  const worseLimit = previous === "open" ? input.inside + settings.keepMargin : input.inside;
  if (input.outside >= worseLimit) {
    return { verdict: "dont_open", reason: "outside_worse", ...numbers, ...base };
  }
  if (outsideCategory !== null && rank(outsideCategory) > rank(settings.worstOutsideCategory)) {
    return { verdict: "dont_open", reason: "outside_dirty", ...numbers, ...base };
  }

  // An open window is kept (see keepMargin); a closed one is opened only for a real gain.
  const enough = previous === "open" || gain >= Math.max(settings.gainOn * input.inside, settings.minGain);
  // A whole category better counts as enough, whatever the share.
  const predictedCategory = categorize(standard, "pm25", predicted);
  const betterCategory = insideCategory !== null && predictedCategory !== null && rank(predictedCategory) < rank(insideCategory) && gain >= settings.minGain;
  if (enough || betterCategory) return { verdict: "open", reason: "outside_cleaner", ...numbers, ...base };

  // Not worth it now: if the forecast promises a clearly cleaner street in the next hours, wait.
  const promised = (input.outsideForecast ?? []).find((f) => f.hours > 0 && input.inside - f.value >= Math.max(settings.gainOn * input.inside, settings.minGain));
  if (promised) return { verdict: "wait", reason: "forecast_better", ...numbers, ...base };
  return { verdict: "dont_open", reason: "no_gain", ...numbers, ...base };
}

/**
 * The advice with the memory of the last one: a change is held back until `minHoldMinutes` have passed since the
 * last change (the dust has noise, and an advice that flickers is worse than none), except the change to
 * "do not open" when the street has become dirtier than the room or too dirty or the weather is not for a window:
 * that one is not delayed.
 */
export function nextAdvice(state: AdviceState | null, input: AdviceInput, nowMs: number, settings: AdviceSettings = DEFAULT_SETTINGS): { advice: Advice; state: AdviceState } {
  const raw = rawAdvice(input, state?.verdict ?? null, settings);
  if (!state || raw.verdict === state.verdict) {
    return { advice: raw, state: state && raw.verdict === state.verdict ? state : { verdict: raw.verdict, since: nowMs } };
  }
  const urgent = raw.verdict === "dont_open" && (raw.reason === "outside_worse" || raw.reason === "outside_dirty" || raw.reason === "comfort");
  const held = nowMs - state.since < settings.minHoldMinutes * 60_000 && !urgent;
  if (held) {
    // Keep the last verdict, with the numbers of now so that the reader sees the present state.
    return { advice: { ...raw, verdict: state.verdict }, state };
  }
  return { advice: raw, state: { verdict: raw.verdict, since: nowMs } };
}
