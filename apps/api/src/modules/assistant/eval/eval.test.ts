import { describe, expect, it } from "vitest";
import { FakeChatProvider } from "../providers/fake.js";
import { EVAL_CASES, type EvalCase } from "./cases.js";
import { runCase, runEval } from "./run.js";
import { scoreCase, summarize, type CaseRun } from "./score.js";

const base: EvalCase = { id: "x", lang: "ru", context: "room", question: "Температура?", kind: "data", expectTools: ["get_current"] };
const run = (over: Partial<CaseRun> = {}): CaseRun => ({
  tools: ["get_current"],
  toolResults: ['{"temperatureC":24.7}'],
  answer: "Сейчас 24.7 °C.",
  latencyMs: 1000,
  failed: false,
  ...over,
});

describe("the question set", () => {
  it("has unique ids and covers every language and every kind", () => {
    const ids = EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(EVAL_CASES.map((c) => c.lang))).toEqual(new Set(["ru", "uz", "en"]));
    expect(new Set(EVAL_CASES.map((c) => c.kind))).toEqual(new Set(["data", "refusal", "limit"]));
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(30);
  });

  it("asks for tools that exist", () => {
    const known = new Set(["get_current", "get_period_summary", "compare_room_street"]);
    for (const c of EVAL_CASES) for (const t of [...c.expectTools, ...(c.forbidTools ?? [])]) expect(known.has(t), `${c.id}: ${t}`).toBe(true);
  });

  it("has patterns that compile", () => {
    for (const c of EVAL_CASES) for (const p of c.forbid ?? []) expect(() => new RegExp(p, "i"), c.id).not.toThrow();
  });
});

describe("scoreCase", () => {
  it("passes a right call and a figure that came from the tool", () => {
    expect(scoreCase(base, run()).pass).toBe(true);
  });

  it("fails when the expected tool was not called", () => {
    const s = scoreCase(base, run({ tools: [] }));
    expect(s.tools).toBe(false);
    expect(s.pass).toBe(false);
  });

  it("fails an invented figure and names it", () => {
    const s = scoreCase(base, run({ answer: "Сейчас 31.4 °C." }));
    expect(s.numbers).toBe(false);
    expect(s.unverified).toContain("31.4");
    expect(s.pass).toBe(false);
  });

  it("fails an empty answer and a failed run", () => {
    expect(scoreCase(base, run({ answer: "" })).answered).toBe(false);
    expect(scoreCase(base, run({ failed: true })).pass).toBe(false);
  });

  it("fails a forbidden claim of a limit case", () => {
    const c: EvalCase = { ...base, kind: "limit", forbid: ["CO2 (is|=) \\d+"] };
    expect(scoreCase(c, run({ answer: "CO2 is 700." })).behaviour).toBe(false);
    expect(scoreCase(c, run({ answer: "The station does not measure CO2." })).behaviour).toBe(true);
  });

  it("passes a refusal only when no data tool was touched", () => {
    const c: EvalCase = { ...base, kind: "refusal", expectTools: [], forbidTools: ["get_current"] };
    expect(scoreCase(c, run({ tools: [], answer: "Я отвечаю только о воздухе." })).pass).toBe(true);
    expect(scoreCase(c, run({ tools: ["get_current"], answer: "Я отвечаю только о воздухе." })).pass).toBe(false);
  });
});

describe("summarize", () => {
  it("gives the shares, the latency and the names of the failed cases", () => {
    const ok = scoreCase(base, run({ latencyMs: 1000 }));
    const bad = scoreCase({ ...base, id: "bad" }, run({ tools: [], latencyMs: 9000 }));
    const s = summarize([ok, bad]);
    expect(s.total).toBe(2);
    expect(s.passed).toBe(1);
    expect(s.toolAccuracy).toBe(0.5);
    expect(s.failed).toEqual(["bad"]);
    expect(s.p95LatencyMs).toBe(9000);
    expect(s.medianLatencyMs).toBe(1000);
  });

  it("does not divide by zero on an empty set", () => {
    expect(summarize([]).toolAccuracy).toBe(1);
  });
});

describe("runCase with a scripted model", () => {
  it("records the tools called, what they returned and the answer", async () => {
    const provider = new FakeChatProvider([
      [{ type: "tool_calls", calls: [{ id: "1", name: "get_current", args: { source: "room" } }] }],
      [{ type: "text", delta: "Сейчас 24.7 °C." }],
    ]);
    const r = await runCase(provider, base);
    expect(r.tools).toEqual(["get_current"]);
    expect(r.toolResults[0]).toContain("24.7");
    expect(r.answer).toBe("Сейчас 24.7 °C.");
    expect(r.failed).toBe(false);
    expect(scoreCase(base, r).pass).toBe(true);
  });

  it("marks a run failed when the model breaks", async () => {
    const r = await runCase(new FakeChatProvider([new Error("boom")]), base);
    expect(r.failed).toBe(true);
  });

  it("runs a list and summarises it", async () => {
    const provider = new FakeChatProvider([
      [{ type: "tool_calls", calls: [{ id: "1", name: "get_current", args: { source: "room" } }] }],
      [{ type: "text", delta: "24.7 °C." }],
      [{ type: "text", delta: "Я отвечаю только о воздухе." }],
    ]);
    const refusal: EvalCase = { ...base, id: "r", kind: "refusal", expectTools: [], forbidTools: ["get_current"] };
    const { summary } = await runEval(provider, [base, refusal]);
    expect(summary.passed).toBe(2);
    expect(summary.refusals).toBe(1);
  });
});
