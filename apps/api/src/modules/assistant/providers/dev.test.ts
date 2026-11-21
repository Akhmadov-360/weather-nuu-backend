import { describe, expect, it } from "vitest";
import { createDevProvider } from "./dev.js";
import type { GenerateInput, ProviderChunk } from "./types.js";

async function collect(input: Partial<GenerateInput>): Promise<ProviderChunk[]> {
  const out: ProviderChunk[] = [];
  for await (const chunk of createDevProvider().generate({
    system: "s",
    messages: [{ role: "user", text: "q" }],
    tools: [],
    maxOutputTokens: 600,
    signal: new AbortController().signal,
    ...input,
  })) {
    out.push(chunk);
  }
  return out;
}

describe("createDevProvider", () => {
  it("first asks for the current room readings", async () => {
    expect(await collect({})).toEqual([{ type: "tool_calls", calls: [{ id: "dev-1", name: "get_current", args: { source: "room" } }] }]);
  });

  it("then answers, and says it is a scripted development answer", async () => {
    const chunks = await collect({
      messages: [
        { role: "user", text: "q" },
        { role: "tool", toolResult: { id: "dev-1", name: "get_current", content: "{}" } },
      ],
    });
    const text = chunks.filter((c) => c.type === "text").map((c) => (c as { delta: string }).delta).join("");
    expect(text).toMatch(/dev provider/i);
    expect(chunks.at(-1)!.type).toBe("usage");
  });
});
