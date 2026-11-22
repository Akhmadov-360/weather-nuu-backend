import { runAgent } from "../agent-loop.js";
import { buildSystemPrompt, exhaustedMessage } from "../prompt.js";
import type { ChatProvider } from "../providers/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { EvalCase } from "./cases.js";
import { EVAL_NOW, evalRegistry } from "./fixtures.js";
import { scoreCase, summarize, type CaseRun, type CaseScore, type Summary } from "./score.js";

/** One question through the real agent loop, with the tools over fixed readings. Never throws. */
export async function runCase(provider: ChatProvider, c: EvalCase, registry: ToolRegistry = evalRegistry()): Promise<CaseRun> {
  const started = Date.now();
  const run: CaseRun = { tools: [], toolResults: [], answer: "", latencyMs: 0, failed: false };
  try {
    for await (const event of runAgent({
      provider,
      registry,
      system: buildSystemPrompt({ lang: c.lang, context: c.context, now: EVAL_NOW }),
      history: [],
      message: c.question,
      maxOutputTokens: 600,
      exhaustedMessage: exhaustedMessage(c.lang),
      signal: new AbortController().signal,
      ctx: { now: EVAL_NOW },
      onProviderError: (error) => {
        const e = error as { kind?: string; status?: number; message?: string };
        run.error = `${e.kind ?? "unknown"}${e.status ? ` ${e.status}` : ""}: ${String(e.message ?? "").slice(0, 160)}`;
      },
      onToolResult: (_name, result) => {
        if (result.ok) run.toolResults.push(result.content);
      },
    })) {
      if (event.type === "tool_start") run.tools.push(event.name);
      else if (event.type === "text") run.answer += event.delta;
      else if (event.type === "error") {
        run.failed = true;
        run.error ??= `stream error ${event.code}`;
      }
    }
  } catch (error) {
    run.failed = true;
    run.error ??= `thrown: ${error instanceof Error ? error.message : String(error)}`.slice(0, 160);
  }
  run.latencyMs = Date.now() - started;
  return run;
}

export async function runEval(
  provider: ChatProvider,
  cases: EvalCase[],
  options: { pauseMs?: number; onCase?: (score: CaseScore, run: CaseRun) => void } = {},
): Promise<{ scores: CaseScore[]; summary: Summary }> {
  const scores: CaseScore[] = [];
  for (const c of cases) {
    const run = await runCase(provider, c);
    const score = scoreCase(c, run);
    scores.push(score);
    options.onCase?.(score, run);
    // A free key allows only so many requests a minute.
    if (options.pauseMs) await new Promise((r) => setTimeout(r, options.pauseMs));
  }
  return { scores, summary: summarize(scores) };
}
