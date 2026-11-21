import {
  ProviderError,
  type ChatProvider,
  type GenerateInput,
  type ProviderChunk,
  type ProviderMessage,
  type ToolCall,
  type ToolSpec,
} from "./types.js";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";

export type GeminiOptions = {
  apiKey: string;
  /** The model's name as the API knows it. It comes from the settings: model names change. */
  model: string;
  baseUrl?: string;
  /** The whole request, answer included. */
  timeoutMs?: number;
  /** Pause before the one retry after a network error. */
  retryDelayMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
};

type Part = Record<string, unknown>;
type Content = { role: "user" | "model"; parts: Part[] };

/** Results of one turn's tool calls must travel together, in one message, whatever order they were stored in. */
function toContents(messages: ProviderMessage[]): Content[] {
  const contents: Content[] = [];
  for (const message of messages) {
    if (message.role === "tool" && message.toolResult) {
      const { id, name, content } = message.toolResult;
      let result: unknown = content;
      try {
        result = JSON.parse(content);
      } catch {
        // The result is plain text (an error for the model to read): send it as it is.
      }
      const part = { functionResponse: { name, id, response: { result } } };
      const last = contents.at(-1);
      if (last?.role === "user" && last.parts.every((p) => "functionResponse" in p)) last.parts.push(part);
      else contents.push({ role: "user", parts: [part] });
    } else if (message.role === "model") {
      const parts: Part[] = [];
      if (message.text) parts.push({ text: message.text });
      for (const call of message.toolCalls ?? []) {
        parts.push({
          functionCall: { name: call.name, args: call.args, id: call.id },
          // Gemini 3 models want the thought signature of a call back with it.
          ...(call.signature ? { thoughtSignature: call.signature } : {}),
        });
      }
      contents.push({ role: "model", parts });
    } else {
      contents.push({ role: "user", parts: [{ text: message.text ?? "" }] });
    }
  }
  return contents;
}

function toDeclarations(tools: ToolSpec[]) {
  if (tools.length === 0) return undefined;
  return [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Gemini over its REST interface (streaming, server-sent events), without an SDK: the format was checked
 * against the live API on 21.11.2026. The key goes in a header, never in the address, and never into an
 * error text. One retry after a network error; a refusal from the server (429, 4xx, 5xx) is not retried.
 */
export class GeminiChatProvider implements ChatProvider {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: GeminiOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retryDelayMs = options.retryDelayMs ?? 300;
    this.doFetch = options.fetch ?? fetch;
  }

  async *generate(input: GenerateInput): AsyncGenerator<ProviderChunk> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = AbortSignal.any([input.signal, timeout]);

    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: input.system }] },
      contents: toContents(input.messages),
      ...(toDeclarations(input.tools) ? { tools: toDeclarations(input.tools) } : {}),
      generationConfig: { maxOutputTokens: input.maxOutputTokens },
    });
    const url = `${this.baseUrl}/v1beta/models/${encodeURIComponent(this.options.model)}:streamGenerateContent?alt=sse`;

    let response: Response | undefined;
    for (let attempt = 0; attempt < 2 && !response; attempt++) {
      try {
        response = await this.doFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.options.apiKey },
          body,
          signal,
        });
      } catch {
        if (input.signal.aborted) return;
        if (timeout.aborted) throw new ProviderError("upstream", "The model did not answer in time");
        if (attempt === 1) throw new ProviderError("upstream", "Could not reach the model");
        await sleep(this.retryDelayMs);
      }
    }
    if (!response) throw new ProviderError("upstream", "Could not reach the model");

    if (response.status === 429) throw new ProviderError("quota", "The model quota is used up");
    if (!response.ok) throw new ProviderError("upstream", `The model answered with HTTP ${response.status}`);
    if (!response.body) throw new ProviderError("upstream", "The model sent no answer");

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    const calls: ToolCall[] = [];
    let usage: { inputTokens: number; outputTokens: number } | undefined;

    function* read(block: string): Generator<ProviderChunk> {
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) return;
      let frame: any; // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        frame = JSON.parse(data);
      } catch {
        return;
      }
      for (const part of frame?.candidates?.[0]?.content?.parts ?? []) {
        if (part.thought === true) continue;
        if (typeof part.text === "string" && part.text !== "") yield { type: "text", delta: part.text };
        if (part.functionCall) {
          calls.push({
            id: part.functionCall.id ?? `call_${calls.length + 1}`,
            name: part.functionCall.name,
            args: part.functionCall.args ?? {},
            ...(part.thoughtSignature ? { signature: part.thoughtSignature } : {}),
          });
        }
      }
      const meta = frame?.usageMetadata;
      if (meta) usage = { inputTokens: meta.promptTokenCount ?? 0, outputTokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0) };
    }

    try {
      for (;;) {
        let result: Awaited<ReturnType<typeof reader.read>>;
        try {
          result = await reader.read();
        } catch {
          if (input.signal.aborted) return;
          throw new ProviderError("upstream", timeout.aborted ? "The model did not answer in time" : "The answer broke off");
        }
        if (input.signal.aborted) return;
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true }).replace(/\r\n|\r/g, "\n");
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          for (const chunk of read(block)) {
            if (input.signal.aborted) return;
            yield chunk;
          }
        }
      }
      buffer += decoder.decode();
      for (const chunk of read(buffer)) yield chunk;
    } finally {
      void reader.cancel().catch(() => undefined);
    }

    if (calls.length > 0) yield { type: "tool_calls", calls };
    if (usage) yield { type: "usage", ...usage };
  }
}
