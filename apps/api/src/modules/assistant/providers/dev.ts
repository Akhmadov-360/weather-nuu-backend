import type { ChatProvider, GenerateInput, ProviderChunk } from "./types.js";

/**
 * The model of the development server (`ASSISTANT_PROVIDER=fake`): it asks for the room readings, then
 * answers with a fixed sentence that says so. It lets the whole path (route, tools, stream, interface) be
 * tried without a key. The server refuses to start with it in production.
 */
export function createDevProvider(): ChatProvider {
  return {
    async *generate(input: GenerateInput): AsyncGenerator<ProviderChunk> {
      if (input.messages.at(-1)?.role === "tool") {
        yield { type: "text", delta: "This is a scripted answer of the dev provider: " };
        yield { type: "text", delta: "the tool was called and its result came back." };
        yield { type: "usage", inputTokens: 0, outputTokens: 0 };
        return;
      }
      yield { type: "tool_calls", calls: [{ id: "dev-1", name: "get_current", args: { source: "room" } }] };
    },
  };
}
