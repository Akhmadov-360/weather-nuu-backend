import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AssistantEvent } from "@weather/contracts";
import { runAgent, type AgentInput } from "./agent-loop.js";
import { FakeChatProvider, type FakeTurn } from "./providers/fake.js";
import { ProviderError } from "./providers/types.js";
import { defineTool, ToolRegistry } from "./tools/registry.js";

const ctx = { now: new Date("2026-11-21T10:00:00Z") };

const getCurrent = defineTool({
  name: "get_current",
  description: "latest",
  schema: z.object({ source: z.enum(["room", "street"]) }),
  handler: async ({ source }) => ({ source, temperatureC: 24.7 }),
});
const broken = defineTool({
  name: "broken",
  description: "always fails",
  schema: z.object({}),
  handler: async () => {
    throw new Error("db down");
  },
});

function setup(script: FakeTurn[], over: Partial<AgentInput> = {}) {
  const provider = new FakeChatProvider(script);
  const input: AgentInput = {
    provider,
    registry: new ToolRegistry([getCurrent, broken]),
    system: "system",
    history: [],
    message: "Какая температура?",
    maxOutputTokens: 600,
    exhaustedMessage: "Не удалось собрать данные.",
    signal: new AbortController().signal,
    ctx,
    ...over,
  };
  return { provider, input };
}

async function collect(input: AgentInput): Promise<AssistantEvent[]> {
  const out: AssistantEvent[] = [];
  for await (const event of runAgent(input)) out.push(event);
  return out;
}

const callTurn = (...calls: { id: string; name: string; args: unknown }[]): FakeTurn => [{ type: "tool_calls", calls }];
const answerTurn = (text: string, inputTokens = 10, outputTokens = 5): FakeTurn => [
  { type: "text", delta: text },
  { type: "usage", inputTokens, outputTokens },
];

describe("runAgent", () => {
  it("answers directly when the model needs no tool", async () => {
    const { input } = setup([answerTurn("Здравствуйте!")]);
    expect(await collect(input)).toEqual([
      { type: "text", delta: "Здравствуйте!" },
      { type: "done", inputTokens: 10, outputTokens: 5 },
    ]);
  });

  it("runs a tool and gives its result back to the model", async () => {
    const { provider, input } = setup([callTurn({ id: "c1", name: "get_current", args: { source: "room" } }), answerTurn("Сейчас 24,7 °C")]);
    const events = await collect(input);
    expect(events.map((e) => e.type)).toEqual(["tool_start", "tool_end", "text", "done"]);
    expect(events[1]).toEqual({ type: "tool_end", id: "c1", name: "get_current", ok: true });
    const second = provider.calls[1]!.messages;
    expect(second.at(-1)).toMatchObject({ role: "tool", toolResult: { id: "c1", name: "get_current" } });
    expect(JSON.parse(second.at(-1)!.toolResult!.content)).toEqual({ source: "room", temperatureC: 24.7 });
    expect(second.at(-2)).toMatchObject({ role: "model", toolCalls: [{ id: "c1" }] });
  });

  it("sums the tokens of all model calls in the final event", async () => {
    const { input } = setup([
      [{ type: "tool_calls", calls: [{ id: "c1", name: "get_current", args: { source: "room" } }] }, { type: "usage", inputTokens: 100, outputTokens: 20 }],
      answerTurn("ok", 150, 30),
    ]);
    const events = await collect(input);
    expect(events.at(-1)).toEqual({ type: "done", inputTokens: 250, outputTokens: 50 });
  });

  it("tells the model a tool failed and goes on to the answer", async () => {
    const { provider, input } = setup([callTurn({ id: "c1", name: "broken", args: {} }), answerTurn("Данных пока нет.")]);
    const events = await collect(input);
    expect(events[1]).toEqual({ type: "tool_end", id: "c1", name: "broken", ok: false });
    expect(events.at(-1)!.type).toBe("done");
    expect(provider.calls[1]!.messages.at(-1)!.toolResult!.content).not.toContain("db down");
  });

  it("tells the model about an unknown tool instead of stopping", async () => {
    const { input } = setup([callTurn({ id: "c1", name: "launch_rocket", args: {} }), answerTurn("Не могу.")]);
    const events = await collect(input);
    expect(events[1]).toMatchObject({ type: "tool_end", ok: false });
    expect(events.at(-1)!.type).toBe("done");
  });

  it("runs several tool calls of one turn together and reports them in order", async () => {
    const { provider, input } = setup([
      callTurn({ id: "a", name: "get_current", args: { source: "room" } }, { id: "b", name: "get_current", args: { source: "street" } }),
      answerTurn("Готово"),
    ]);
    const events = await collect(input);
    expect(events.slice(0, 4).map((e) => `${e.type}:${(e as { id?: string }).id}`)).toEqual(["tool_start:a", "tool_start:b", "tool_end:a", "tool_end:b"]);
    const results = provider.calls[1]!.messages.filter((m) => m.role === "tool").map((m) => m.toolResult!.id);
    expect(results).toEqual(["a", "b"]);
  });

  it("stops after five rounds of tool calls and gives the honest answer", async () => {
    const forever = Array.from({ length: 5 }, (_, i) => callTurn({ id: `c${i}`, name: "get_current", args: { source: "room" } }));
    const { provider, input } = setup(forever);
    const events = await collect(input);
    expect(provider.calls).toHaveLength(5);
    expect(events.slice(-2)).toEqual([
      { type: "text", delta: "Не удалось собрать данные." },
      { type: "done", inputTokens: 0, outputTokens: 0 },
    ]);
  });

  it("passes the limits and the tool list to the model", async () => {
    const { provider, input } = setup([answerTurn("a")], { maxOutputTokens: 321 });
    await collect(input);
    expect(provider.calls[0]!.maxOutputTokens).toBe(321);
    expect(provider.calls[0]!.tools.map((t) => t.name)).toEqual(["get_current", "broken"]);
    expect(provider.calls[0]!.messages.at(-1)).toEqual({ role: "user", text: "Какая температура?" });
  });

  it("puts the history before the question", async () => {
    const { provider, input } = setup([answerTurn("a")], { history: [{ role: "user", text: "Привет" }, { role: "model", text: "Здравствуйте" }] });
    await collect(input);
    expect(provider.calls[0]!.messages.map((m) => m.text)).toEqual(["Привет", "Здравствуйте", "Какая температура?"]);
  });

  it("stops without a final event when the request is cancelled in the middle of a stream", async () => {
    const controller = new AbortController();
    const { input } = setup([[{ type: "text", delta: "a" }, { type: "text", delta: "b" }]], { signal: controller.signal });
    const events: AssistantEvent[] = [];
    for await (const event of runAgent(input)) {
      events.push(event);
      controller.abort();
    }
    expect(events).toEqual([{ type: "text", delta: "a" }]);
  });

  it("stops without a second model call when the request is cancelled while a tool runs", async () => {
    const controller = new AbortController();
    const slow = defineTool({
      name: "slow",
      description: "cancels the request while running",
      schema: z.object({}),
      handler: async () => {
        controller.abort();
        return {};
      },
    });
    const { provider, input } = setup([callTurn({ id: "c1", name: "slow", args: {} }), answerTurn("never")], {
      registry: new ToolRegistry([slow]),
      signal: controller.signal,
    });
    const events = await collect(input);
    expect(provider.calls).toHaveLength(1);
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("reports a provider failure as an upstream error", async () => {
    const { input } = setup([new Error("socket hang up")]);
    expect(await collect(input)).toEqual([{ type: "error", code: "upstream" }]);
  });

  it("reports a quota failure as a quota error", async () => {
    const { input } = setup([new ProviderError("quota", "429")]);
    expect(await collect(input)).toEqual([{ type: "error", code: "quota" }]);
  });

  it("keeps the text that was already sent when the provider fails on a later round", async () => {
    const { input } = setup([
      [{ type: "text", delta: "Минуту. " }, { type: "tool_calls", calls: [{ id: "c1", name: "get_current", args: { source: "room" } }] }],
      new Error("boom"),
    ]);
    const events = await collect(input);
    expect(events.map((e) => e.type)).toEqual(["text", "tool_start", "tool_end", "error"]);
  });
});
