import "dotenv/config";
import { writeFileSync } from "node:fs";
import { EVAL_CASES } from "../modules/assistant/eval/cases.js";
import { runEval } from "../modules/assistant/eval/run.js";
import { GeminiChatProvider } from "../modules/assistant/providers/gemini.js";

/**
 * The question set against the real model, with the real tools over fixed readings:
 *   pnpm --filter @weather/api eval:assistant [--out result.json] [--only ru|uz|en] [--pause 8000]
 * Needs GEMINI_API_KEY and ASSISTANT_MODEL in apps/api/.env. Questions and answers go to the console and the
 * optional file only; the key is never printed.
 */
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.ASSISTANT_MODEL;
if (!apiKey || !model) {
  console.error("Set GEMINI_API_KEY and ASSISTANT_MODEL in apps/api/.env");
  process.exit(1);
}
const only = flag("--only");
const cases = only ? EVAL_CASES.filter((c) => c.lang === only) : EVAL_CASES;

const answers: Record<string, string> = {};
const errors: Record<string, string> = {};
const { scores, summary } = await runEval(new GeminiChatProvider({ apiKey, model }), cases, {
  pauseMs: Number(flag("--pause") ?? 8000),
  onCase: (s, r) => {
    answers[s.id] = r.answer;
    if (r.error) errors[s.id] = r.error;
    console.log(
      `${s.pass ? "PASS" : "FAIL"} ${s.id.padEnd(22)} ${String(s.latencyMs).padStart(6)} ms  tools:${s.tools ? "ok" : "NO"} numbers:${s.numbers ? "ok" : s.unverified.join(",")} behaviour:${s.behaviour ? "ok" : "NO"}${r.error ? `  [${r.error}]` : ""}`,
    );
  },
});

const pct = (x: number) => `${(x * 100).toFixed(0)} %`;
console.log(`\nmodel ${model}, ${summary.total} questions`);
console.log(
  `passed ${summary.passed}/${summary.total}; right tools ${pct(summary.toolAccuracy)}; figures from tools ${pct(summary.numberMatch)}; refusals ${pct(summary.refusals)}; failed runs ${summary.failures}`,
);
console.log(`latency median ${summary.medianLatencyMs} ms, p95 ${summary.p95LatencyMs} ms`);
if (summary.failed.length) console.log(`failed: ${summary.failed.join(", ")}`);
const out = flag("--out");
if (out) writeFileSync(out, JSON.stringify({ model, summary, scores, answers, errors }, null, 2));
