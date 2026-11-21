import { describe, expect, it } from "vitest";
import { FakeChatProvider } from "./fake.js";
import type { ChatProvider, GenerateInput, ProviderChunk } from "./types.js";

function input(over: Partial<GenerateInput> = {}): GenerateInput {
  return {
    system: "s",
    messages: [{ role: "user", text: "q" }],
    tools: [],
    maxOutputTokens: 600,
    signal: new AbortController().signal,
    ...over,
  };
}

async function collect(provider: ChatProvider, i: GenerateInput): Promise<ProviderChunk[]> {
  const out: ProviderChunk[] = [];
  for await (const chunk of provider.generate(i)) out.push(chunk);
  return out;
}

describe("FakeChatProvider", () => {
  it("plays one scripted turn per call: first a tool call, then the answer and the usage", async () => {
    const provider = new FakeChatProvider([
      [{ type: "tool_calls", calls: [{ id: "c1", name: "get_current", args: { source: "room" } }] }],
      [
        { type: "text", delta: "Сейчас 24 °C" },
        { type: "usage", inputTokens: 10, outputTokens: 5 },
      ],
    ]);
    expect(await collect(provider, input())).toEqual([
      { type: "tool_calls", calls: [{ id: "c1", name: "get_current", args: { source: "room" } }] },
    ]);
    expect(await collect(provider, input())).toEqual([
      { type: "text", delta: "Сейчас 24 °C" },
      { type: "usage", inputTokens: 10, outputTokens: 5 },
    ]);
  });

  it("records what it was asked, including maxOutputTokens", async () => {
    const provider = new FakeChatProvider([[{ type: "text", delta: "a" }]]);
    await collect(provider, input({ maxOutputTokens: 123 }));
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.maxOutputTokens).toBe(123);
  });

  it("stops without an error when the request is cancelled", async () => {
    const controller = new AbortController();
    const provider = new FakeChatProvider([
      [
        { type: "text", delta: "a" },
        { type: "text", delta: "b" },
      ],
    ]);
    const seen: ProviderChunk[] = [];
    for await (const chunk of provider.generate(input({ signal: controller.signal }))) {
      seen.push(chunk);
      controller.abort();
    }
    expect(seen).toEqual([{ type: "text", delta: "a" }]);
  });

  it("fails loudly when the script has run out, so a test does not hang on a missing turn", async () => {
    const provider = new FakeChatProvider([]);
    await expect(collect(provider, input())).rejects.toThrow(/script/i);
  });

  it("can play an error as a turn", async () => {
    const provider = new FakeChatProvider([new Error("boom")]);
    await expect(collect(provider, input())).rejects.toThrow("boom");
  });
});
