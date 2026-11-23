import { categorize, getStandard } from "@weather/air-quality";
import { mulberry32 } from "../events/synthetic.js";
import { SYNTHETIC_ROOM } from "../events/synthetic.js";
import { DEFAULT_SETTINGS, nextAdvice, rawAdvice, type Advice, type AdviceInput, type AdviceState, type Verdict } from "./advice.js";

const LESSON_FROM = 13 * 60 + 30;
const LESSON_TO = 17 * 60 + 50;
/** The air exchange of the synthetic room with the window wide open, and its λ: the truth the advice is judged against. */
const LAMBDA_OPEN = SYNTHETIC_ROOM.aClosed + SYNTHETIC_ROOM.aOpenExtra + SYNTHETIC_ROOM.k;

/** --- Sensitivity to the error of λ_open ------------------------------------------------------------------ */

export type SensitivityRow = { error: number; scenarios: number; unchanged: number; changes: Record<string, number> };

const INSIDE = [10, 15, 20, 30, 40, 60, 90, 120, 200];
const OUTSIDE = [3, 5, 8, 10, 15, 20, 30, 40, 60, 80, 120];

/**
 * The advice for a grid of rooms and streets with the true λ_open, against the same advice with λ_open wrong by a
 * given share: the share of the situations in which the advice does not change. Only the situations with a street
 * cleaner than the room are counted at the edge (where the answer depends on λ at all they are the interesting ones).
 */
export function evaluateSensitivity(errors: number[] = [-0.5, -0.2, 0.2, 0.5]): SensitivityRow[] {
  const make = (inside: number, outside: number, lambda: number): AdviceInput => ({ inside, outside, outsideTemp: 15, lambdaOpen: lambda, lambdaSource: "data" });
  return errors.map((error) => {
    let scenarios = 0;
    let unchanged = 0;
    const changes: Record<string, number> = {};
    for (const inside of INSIDE) {
      for (const outside of OUTSIDE) {
        const truth = rawAdvice(make(inside, outside, LAMBDA_OPEN), null).verdict;
        const wrong = rawAdvice(make(inside, outside, LAMBDA_OPEN * (1 + error)), null).verdict;
        scenarios++;
        if (truth === wrong) unchanged++;
        else changes[`${truth}->${wrong}`] = (changes[`${truth}->${wrong}`] ?? 0) + 1;
      }
    }
    return { error, scenarios, unchanged, changes };
  });
}

/** --- The advice against "always open" and "never" on a simulated day ----------------------------------- */

export type PolicyName = "never" | "always" | "advice";

export type Scenario = { name: string; outside: (minute: number) => number };

export const SCENARIOS: Scenario[] = [
  { name: "clean street (10)", outside: () => 10 },
  { name: "dirty street (90)", outside: () => 90 },
  { name: "episode in the afternoon", outside: (m) => 15 + 95 * Math.max(0, Math.min(1, (m - 15 * 60) / 90)) * (m < 17 * 60 + 30 ? 1 : Math.max(0, 1 - (m - (17 * 60 + 30)) / 60)) },
  { name: "street between 20 and 60", outside: (m) => 40 + 20 * Math.sin((2 * Math.PI * (m - 6 * 60)) / 1440) },
];

export type PolicyResult = { policy: PolicyName; meanInside: number; minutesOpen: number; switchesPerHour: number; minutesAboveModerate: number };

/**
 * One simulated day of the room by the model of the dust (a mass balance, a minute at a time) with a policy for the
 * window. The room has a source (people in the lesson hours); the sensor has noise, and the advice sees the average of
 * the last five minutes, as the platform would. Measured over the lesson hours: the mean dust inside, how long the
 * window was open, how often the state changed, and how long the air inside was worse than "moderate".
 */
export function simulateDay(options: { scenario: Scenario; policy: PolicyName; lambdaAssumed?: number; seed?: number; noise?: number }): PolicyResult {
  const { aClosed, aOpenExtra, k } = SYNTHETIC_ROOM;
  const p = 0.85;
  const rand = mulberry32(options.seed ?? 11);
  const noise = options.noise ?? 1;
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());
  const lambdaAssumed = options.lambdaAssumed ?? LAMBDA_OPEN;
  const dt = 1 / 60;

  let inside = (aClosed * p * options.scenario.outside(0) + 22) / (aClosed + k);
  let open = false;
  let state: AdviceState | null = null;
  const recent: number[] = [];
  let sum = 0;
  let count = 0;
  let minutesOpen = 0;
  let switches = 0;
  let above = 0;
  const limit = getStandard().breakpoints.pm25.find((b) => b.category === "moderate")!.cHigh;

  for (let m = 0; m < 24 * 60; m++) {
    const lesson = m >= LESSON_FROM && m < LESSON_TO;
    const outside = options.scenario.outside(m);
    const reading = inside + gauss() * noise;
    recent.push(reading);
    if (recent.length > 5) recent.shift();

    let want: boolean = open;
    if (options.policy === "never") want = false;
    else if (options.policy === "always") want = lesson;
    else if (m % 5 === 0 && lesson) {
      const smooth = recent.reduce((a, b) => a + b, 0) / recent.length;
      const r: { advice: Advice; state: AdviceState } = nextAdvice(state, { inside: smooth, outside, outsideTemp: 15, lambdaOpen: lambdaAssumed, lambdaSource: "data" }, m * 60_000);
      state = r.state;
      want = r.advice.verdict === "open";
    } else if (!lesson) want = false;
    if (want !== open && lesson) switches++;
    open = want;

    const a = aClosed + (open ? aOpenExtra : 0);
    const source = 22 + (lesson ? 6 : 0);
    inside += (a * p * outside - (a + k) * inside + source) * dt;
    inside = Math.max(0, inside);
    if (lesson) {
      sum += inside;
      count++;
      if (open) minutesOpen++;
      if (inside > limit) above++;
    }
  }
  return { policy: options.policy, meanInside: sum / count, minutesOpen, switchesPerHour: switches / ((LESSON_TO - LESSON_FROM) / 60), minutesAboveModerate: above };
}

export function evaluatePolicies(options: { lambdaAssumed?: number } = {}): { scenario: string; results: PolicyResult[] }[] {
  return SCENARIOS.map((scenario) => ({
    scenario: scenario.name,
    results: (["never", "always", "advice"] as const).map((policy) => simulateDay({ scenario, policy, ...(options.lambdaAssumed ? { lambdaAssumed: options.lambdaAssumed } : {}) })),
  }));
}

export function formatSensitivity(rows: SensitivityRow[]): string {
  return [
    "error of lambda_open   situations   advice unchanged   what changed",
    ...rows.map((r) => `${(r.error * 100).toFixed(0).padStart(8)} %   ${String(r.scenarios).padStart(14)}   ${((r.unchanged / r.scenarios) * 100).toFixed(0).padStart(14)} %   ${Object.entries(r.changes).map(([k, v]) => `${k}: ${v}`).join(", ") || "-"}`),
  ].join("\n");
}

export function formatPolicies(blocks: ReturnType<typeof evaluatePolicies>): string {
  const lines = ["scenario                     policy   mean dust (lesson)   min open   switches/h   min above 'moderate'"];
  for (const b of blocks) {
    for (const r of b.results) {
      lines.push(`${b.scenario.padEnd(28)} ${r.policy.padEnd(7)} ${r.meanInside.toFixed(1).padStart(18)}   ${String(r.minutesOpen).padStart(8)}   ${r.switchesPerHour.toFixed(2).padStart(10)}   ${String(r.minutesAboveModerate).padStart(20)}`);
    }
  }
  return lines.join("\n");
}

export type { Verdict };
export const _internals = { categorize, LAMBDA_OPEN, DEFAULT_SETTINGS };
