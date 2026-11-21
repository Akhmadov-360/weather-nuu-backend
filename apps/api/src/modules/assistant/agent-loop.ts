import type { AssistantEvent } from "@weather/contracts";
import { ProviderError, type ChatProvider, type ProviderMessage, type ToolCall } from "./providers/types.js";
import type { ToolContext, ToolRegistry } from "./tools/registry.js";

/** At most this many model calls per question: the loop ends even if the model keeps asking for tools. */
export const MAX_ITERATIONS = 5;

export type AgentInput = {
  provider: ChatProvider;
  registry: ToolRegistry;
  system: string;
  /** The dialogue so far, already converted to provider messages (text only). */
  history: ProviderMessage[];
  message: string;
  maxOutputTokens: number;
  /** Said to the visitor, in their language, when the model never produced an answer. */
  exhaustedMessage: string;
  maxIterations?: number;
  signal: AbortSignal;
  ctx: ToolContext;
};

/**
 * The agent as a small state machine: ask the model; if it asks for tools, run them and ask again;
 * if it answers, finish. A pure function of its inputs (provider and registry are passed in), so it is
 * tested with a scripted model and no network. If the request is cancelled it just stops: no final event.
 */
export async function* runAgent(input: AgentInput): AsyncGenerator<AssistantEvent> {
  const limit = input.maxIterations ?? MAX_ITERATIONS;
  const messages: ProviderMessage[] = [...input.history, { role: "user", text: input.message }];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let round = 0; round < limit; round++) {
    let text = "";
    const calls: ToolCall[] = [];
    try {
      for await (const chunk of input.provider.generate({
        system: input.system,
        messages,
        tools: input.registry.specs(),
        maxOutputTokens: input.maxOutputTokens,
        signal: input.signal,
      })) {
        if (chunk.type === "text") {
          text += chunk.delta;
          yield { type: "text", delta: chunk.delta };
        } else if (chunk.type === "tool_calls") {
          calls.push(...chunk.calls);
        } else {
          inputTokens += chunk.inputTokens;
          outputTokens += chunk.outputTokens;
        }
      }
    } catch (error) {
      if (input.signal.aborted) return;
      yield { type: "error", code: error instanceof ProviderError && error.kind === "quota" ? "quota" : "upstream" };
      return;
    }
    if (input.signal.aborted) return;

    if (calls.length === 0) {
      yield { type: "done", inputTokens, outputTokens };
      return;
    }

    messages.push({ role: "model", ...(text ? { text } : {}), toolCalls: calls });
    for (const call of calls) yield { type: "tool_start", id: call.id, name: call.name };
    const results = await Promise.all(calls.map((call) => input.registry.run(call.name, call.args, input.ctx)));
    if (input.signal.aborted) return;
    for (const [i, call] of calls.entries()) {
      const result = results[i]!;
      yield { type: "tool_end", id: call.id, name: call.name, ok: result.ok };
      messages.push({ role: "tool", toolResult: { id: call.id, name: call.name, content: result.content } });
    }
  }

  yield { type: "text", delta: input.exhaustedMessage };
  yield { type: "done", inputTokens, outputTokens };
}
