/** A tool the model may call: its name, what it is for, and the JSON Schema of its arguments. */
export type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/** `signature` is opaque data of the provider (Gemini's thought signature): it is given back with the call. */
export type ToolCall = { id: string; name: string; args: unknown; signature?: string };

/** One message of the conversation as a model provider sees it. */
export type ProviderMessage = {
  role: "user" | "model" | "tool";
  text?: string;
  /** Set on a `model` message that asks for tools. */
  toolCalls?: ToolCall[];
  /** Set on a `tool` message: what the tool returned for the call with this id. */
  toolResult?: { id: string; name: string; content: string };
};

export type GenerateInput = {
  system: string;
  messages: ProviderMessage[];
  tools: ToolSpec[];
  maxOutputTokens: number;
  signal: AbortSignal;
};

/** What a provider streams back: pieces of text, a request to call tools, and the token count at the end. */
export type ProviderChunk =
  | { type: "text"; delta: string }
  | { type: "tool_calls"; calls: ToolCall[] }
  | { type: "usage"; inputTokens: number; outputTokens: number };

/** Why a provider failed, in terms the agent loop maps to the error codes of the contract. */
export class ProviderError extends Error {
  constructor(
    readonly kind: "quota" | "upstream",
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ChatProvider {
  /** Streams the next model turn. Must stop quietly (no exception) when `signal` is aborted. */
  generate(input: GenerateInput): AsyncIterable<ProviderChunk>;
}
