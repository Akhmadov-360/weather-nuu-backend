import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
import { AnswerCache, cacheKey } from "./answer-cache.js";
import { createAssistantRoutes } from "./assistant.routes.js";
import { CapacityProvider, type CapacityEvent } from "./providers/capacity.js";
import { createProvider } from "./providers/factory.js";
import { FakeChatProvider } from "./providers/fake.js";
import { ProviderError, type ChatProvider, type GenerateInput, type ProviderChunk } from "./providers/types.js";
import { createRateLimiter } from "./rate-limiter.js";
import { createKnowledgeTool } from "./tools/knowledge-tool.js";
import { defineTool, ToolRegistry } from "./tools/registry.js";

const input = (): GenerateInput => ({ system: "s", messages: [{ role: "user", text: "q" }], tools: [], maxOutputTokens: 10, signal: new AbortController().signal });
const drain = async (p: ChatProvider, i = input()): Promise<ProviderChunk[]> => {
  const out: ProviderChunk[] = [];
  for await (const c of p.generate(i)) out.push(c);
  return out;
};
const quota = () => new ProviderError("quota", "used up", 429);
const says = (text: string): ProviderChunk[] => [{ type: "text", delta: text }];

describe("CapacityProvider", () => {
  it("uses the first model while it works", async () => {
    const a = new FakeChatProvider([says("A")]);
    const b = new FakeChatProvider([says("B")]);
    const p = new CapacityProvider([{ name: "a", provider: a }, { name: "b", provider: b }]);
    expect(await drain(p)).toEqual(says("A"));
    expect(b.calls).toHaveLength(0);
  });

  it("repeats the request on the next model when the first is out of quota, and says so", async () => {
    const events: CapacityEvent[] = [];
    const p = new CapacityProvider([{ name: "a", provider: new FakeChatProvider([quota()]) }, { name: "b", provider: new FakeChatProvider([says("B")]) }], { onEvent: (e) => events.push(e) });
    expect(await drain(p)).toEqual(says("B"));
    expect(events).toEqual([{ type: "fallback", from: "a", to: "b" }]);
  });

  it("does not ask a model that has just refused until it has rested, then asks it again", async () => {
    let t = 1_000;
    const a = new FakeChatProvider([quota(), says("A again")]);
    const b = new FakeChatProvider([says("B1"), says("B2")]);
    const p = new CapacityProvider([{ name: "a", provider: a }, { name: "b", provider: b }], { now: () => t, cooldownMs: 60_000 });
    await drain(p);
    expect(p.usageSnapshot()[0]).toMatchObject({ model: "a", cooling: true });
    t += 10_000;
    await drain(p);
    expect(a.calls).toHaveLength(1);
    t += 60_000;
    expect(await drain(p)).toEqual(says("A again"));
  });

  it("throws the quota error when every model is out, and reports it", async () => {
    const events: CapacityEvent[] = [];
    const p = new CapacityProvider([{ name: "a", provider: new FakeChatProvider([quota()]) }, { name: "b", provider: new FakeChatProvider([quota()]) }], { onEvent: (e) => events.push(e) });
    await expect(drain(p)).rejects.toMatchObject({ kind: "quota" });
    expect(events.at(-1)).toEqual({ type: "exhausted", models: ["a", "b"] });
  });

  it("does not repeat a failure that is not a quota failure, nor one that came after the answer began", async () => {
    const b = new FakeChatProvider([says("B")]);
    const upstream = new CapacityProvider([{ name: "a", provider: new FakeChatProvider([new ProviderError("upstream", "boom", 500)]) }, { name: "b", provider: b }]);
    await expect(drain(upstream)).rejects.toMatchObject({ kind: "upstream" });
    expect(b.calls).toHaveLength(0);

    const half: ChatProvider = {
      async *generate() {
        yield { type: "text", delta: "Half" } as ProviderChunk;
        throw quota();
      },
    };
    const b2 = new FakeChatProvider([says("B")]);
    await expect(drain(new CapacityProvider([{ name: "a", provider: half }, { name: "b", provider: b2 }]))).rejects.toMatchObject({ kind: "quota" });
    expect(b2.calls).toHaveLength(0);
  });

  it("skips a model that has used its day's allowance, without asking it, and warns when it is close", async () => {
    const events: CapacityEvent[] = [];
    const a = new FakeChatProvider([says("1"), says("2"), says("3"), says("4")]);
    const b = new FakeChatProvider([says("B")]);
    const p = new CapacityProvider([{ name: "a", provider: a, dailyLimit: 5 }, { name: "b", provider: b }], { onEvent: (e) => events.push(e) });
    for (let i = 0; i < 4; i++) await drain(p);
    expect(events).toEqual([{ type: "near_limit", model: "a", used: 4, limit: 5 }]);
    const a2 = new FakeChatProvider([says("5")]);
    const q = new CapacityProvider([{ name: "a", provider: a2, dailyLimit: 1 }, { name: "b", provider: new FakeChatProvider([says("B")]) }]);
    await drain(q);
    expect(await drain(q)).toEqual(says("B"));
    expect(a2.calls).toHaveLength(1);
  });

  it("counts a day on the clock of the quota (Pacific time), not of the server", async () => {
    // 07:00 UTC on 24 Nov is still 23 Nov in Los Angeles; 08:30 UTC is already 24 Nov there (UTC-8 in November).
    let t = Date.parse("2026-11-24T07:00:00Z");
    const a = new FakeChatProvider([says("1"), says("2")]);
    const p = new CapacityProvider([{ name: "a", provider: a, dailyLimit: 1 }, { name: "b", provider: new FakeChatProvider([says("B"), says("B")]) }], { now: () => t });
    await drain(p);
    expect(p.usageSnapshot()[0]!.today).toBe(1);
    expect(await drain(p)).toEqual(says("B"));
    t = Date.parse("2026-11-24T08:30:00Z");
    expect(p.usageSnapshot()[0]!.today).toBe(0);
    expect(await drain(p)).toEqual(says("2"));
  });

  it("needs at least one model", () => {
    expect(() => new CapacityProvider([])).toThrow();
  });
});

describe("createProvider with a fallback model", () => {
  it("builds one model when there is no fallback, two when there is", () => {
    const base = { ASSISTANT_PROVIDER: "gemini" as const, GEMINI_API_KEY: "k", ASSISTANT_MODEL: "m1" };
    const one = createProvider(base)!;
    expect(one.usageSnapshot!().map((m) => m.model)).toEqual(["m1"]);
    const two = createProvider({ ...base, ASSISTANT_FALLBACK_MODEL: "m2", ASSISTANT_DAILY_LIMIT: 500 })!;
    expect(two.usageSnapshot!()).toEqual([
      { model: "m1", today: 0, limit: 500, cooling: false },
      { model: "m2", today: 0, limit: null, cooling: false },
    ]);
    expect(createProvider({ ...base, ASSISTANT_FALLBACK_MODEL: "m1" })!.usageSnapshot!()).toHaveLength(1);
  });
});

describe("AnswerCache", () => {
  it("keeps an answer until it is too old", () => {
    let t = 0;
    const cache = new AnswerCache({ ttlMs: 1000, now: () => t });
    cache.set("k", [{ type: "done", inputTokens: 1, outputTokens: 1 }]);
    expect(cache.get("k")).toHaveLength(1);
    t = 1001;
    expect(cache.get("k")).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("drops the oldest when full, and does nothing when switched off", () => {
    const cache = new AnswerCache({ ttlMs: 1000, maxEntries: 2 });
    cache.set("a", []);
    cache.set("b", []);
    cache.set("c", []);
    expect(cache.get("a")).toBeNull();
    expect(cache.get("c")).not.toBeNull();
    const off = new AnswerCache({ ttlMs: 0 });
    off.set("a", []);
    expect(off.get("a")).toBeNull();
    expect(off.enabled).toBe(false);
  });

  it("gives one key to the same question written with other case, spaces and a question mark", () => {
    expect(cacheKey("ru", "  Какая НОРМА PM2.5 по ВОЗ? ")).toBe(cacheKey("ru", "какая норма pm2.5 по воз"));
    expect(cacheKey("ru", "норма")).not.toBe(cacheKey("en", "норма"));
  });
});

describe("the route with the cache", () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => {
    while (apps.length) await apps.pop()!.close();
  });

  const hit = {
    chunk: { id: "who#1", source: "WHO 2021", kind: "standard", lang: "en" as const, title: "T", text: "PM2.5 24-hour guideline is 15", contentHash: "h", model: "m", dim: 1, embedding: new Float32Array([1]) },
    score: 1,
  };
  const knowledge = createKnowledgeTool(async () => [hit]);
  const current = defineTool({ name: "get_current", description: "d", schema: z.object({ source: z.enum(["room", "street"]) }), handler: async () => ({ temperatureC: 24.7 }) });
  const knowledgeTurn = [
    [{ type: "tool_calls" as const, calls: [{ id: "k", name: "search_knowledge", args: { query: "who" } }] }],
    [{ type: "text" as const, delta: "The WHO guideline is 15" }, { type: "usage" as const, inputTokens: 3, outputTokens: 3 }],
  ];
  const currentTurn = [
    [{ type: "tool_calls" as const, calls: [{ id: "c", name: "get_current", args: { source: "room" } }] }],
    [{ type: "text" as const, delta: "It is 24.7" }, { type: "usage" as const, inputTokens: 3, outputTokens: 3 }],
  ];

  async function build(script: ConstructorParameters<typeof FakeChatProvider>[0]) {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(errorHandlerPlugin);
    const provider = new FakeChatProvider(script);
    await app.register(
      createAssistantRoutes({
        enabled: true,
        provider,
        registry: new ToolRegistry([current, knowledge]),
        limiter: createRateLimiter({ perMinute: 100, perHour: 1000, globalPerMinute: 1000 }),
        maxOutputTokens: 100,
        now: () => new Date("2026-11-23T10:00:00Z"),
        pingMs: 15_000,
        cache: new AnswerCache({ ttlMs: 60_000 }),
      }),
    );
    apps.push(app);
    return { app, provider };
  }
  const ask = (app: FastifyInstance, message: string, history: object[] = []) =>
    app.inject({ method: "POST", url: "/v1/assistant/chat", payload: { message, history, lang: "en", context: "room" } });

  it("answers the same knowledge question again without asking the model, with the same events", async () => {
    vi.useRealTimers();
    const { app, provider } = await build(knowledgeTurn);
    const first = await ask(app, "What is the WHO guideline for PM2.5?");
    const second = await ask(app, "what is the WHO guideline for PM2.5");
    expect(provider.calls).toHaveLength(2);
    expect(second.payload).toBe(first.payload);
    expect(second.payload).toContain("citations");
  });

  it("does not keep an answer that used the readings", async () => {
    const { app, provider } = await build([...currentTurn, ...currentTurn]);
    await ask(app, "What is the temperature?");
    await ask(app, "What is the temperature?");
    expect(provider.calls).toHaveLength(4);
  });

  it("does not use the cache in the middle of a dialogue", async () => {
    const { app, provider } = await build([...knowledgeTurn, ...knowledgeTurn]);
    await ask(app, "What is the WHO guideline for PM2.5?");
    await ask(app, "What is the WHO guideline for PM2.5?", [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }]);
    expect(provider.calls).toHaveLength(4);
  });
});
