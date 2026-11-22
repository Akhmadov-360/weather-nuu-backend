import { findUnverifiedNumbers } from "../verify-numbers.js";
import type { EvalCase } from "./cases.js";

/** What happened when a case was run: nothing here is judged yet. */
export type CaseRun = {
  tools: string[];
  toolResults: string[];
  answer: string;
  latencyMs: number;
  /** An error event or a thrown error ended the answer. */
  failed: boolean;
  /** Why it failed: the error code of the stream and the kind and HTTP status of the model's failure. */
  error?: string;
};

export type CaseScore = {
  id: string;
  kind: EvalCase["kind"];
  /** Every expected tool was called and no forbidden one. */
  tools: boolean;
  /** No figure in the answer that no tool returned (and none from the question). */
  numbers: boolean;
  /** None of the claims the case forbids (a station that measures CO2, dust outside). */
  behaviour: boolean;
  /** The answer is there and the run did not fail. */
  answered: boolean;
  pass: boolean;
  unverified: string[];
  latencyMs: number;
};

export function scoreCase(c: EvalCase, run: CaseRun): CaseScore {
  const called = new Set(run.tools);
  const tools = c.expectTools.every((t) => called.has(t)) && !(c.forbidTools ?? []).some((t) => called.has(t));
  const unverified = findUnverifiedNumbers(run.answer, run.toolResults, c.question);
  const numbers = unverified.length === 0;
  const answered = !run.failed && run.answer.trim().length > 0;
  const behaviour = !(c.forbid ?? []).some((p) => new RegExp(p, "i").test(run.answer));
  return {
    id: c.id,
    kind: c.kind,
    tools,
    numbers,
    behaviour,
    answered,
    pass: tools && numbers && behaviour && answered,
    unverified,
    latencyMs: run.latencyMs,
  };
}

export type Summary = {
  total: number;
  passed: number;
  /** Share of cases with the right tools. */
  toolAccuracy: number;
  /** Share of data and limit cases whose figures all came from tools. */
  numberMatch: number;
  /** Share of refusal cases handled without touching data tools. */
  refusals: number;
  failures: number;
  medianLatencyMs: number;
  p95LatencyMs: number;
  failed: string[];
};

const share = (xs: boolean[]): number => (xs.length ? xs.filter(Boolean).length / xs.length : 1);

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
}

export function summarize(scores: CaseScore[]): Summary {
  const latencies = scores.map((s) => s.latencyMs).sort((a, b) => a - b);
  return {
    total: scores.length,
    passed: scores.filter((s) => s.pass).length,
    toolAccuracy: share(scores.map((s) => s.tools)),
    numberMatch: share(scores.filter((s) => s.kind !== "refusal").map((s) => s.numbers)),
    refusals: share(scores.filter((s) => s.kind === "refusal").map((s) => s.tools && s.behaviour && s.answered)),
    failures: scores.filter((s) => !s.answered).length,
    medianLatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    failed: scores.filter((s) => !s.pass).map((s) => s.id),
  };
}
