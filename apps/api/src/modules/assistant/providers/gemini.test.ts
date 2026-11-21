import { describe, expect, it } from "vitest";
import { GeminiChatProvider } from "./gemini.js";
import { ProviderError, type GenerateInput, type ProviderChunk } from "./types.js";

const KEY = "AQ.test-key-should-never-appear-in-errors";
const encoder = new TextEncoder();

/** One server-sent event of the Gemini stream. */
const frame = (payload: object) => `data: ${JSON.stringify(payload)}\n\n`;

function sse(frames: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

type Call = { url: string; init: RequestInit };

function providerWith(respond: (call: Call, n: number) => Response | Promise<Response>, over: Partial<ConstructorParameters<typeof GeminiChatProvider>[0]> = {}) {
  const calls: Call[] = [];
  const provider = new GeminiChatProvider({
    apiKey: KEY,
    model: "gemini-test",
    fetch: async (url, init) => {
      const call = { url: String(url), init: init ?? {} };
      calls.push(call);
      return respond(call, calls.length);
    },
    retryDelayMs: 0,
    ...over,
  });
  return { provider, calls };
}

function input(over: Partial<GenerateInput> = {}): GenerateInput {
  return {
    system: "Be brief.",
    messages: [{ role: "user", text: "Какая температура?" }],
    tools: [],
    maxOutputTokens: 600,
    signal: new AbortController().signal,
    ...over,
  };
}

async function collect(provider: GeminiChatProvider, i: GenerateInput): Promise<ProviderChunk[]> {
  const out: ProviderChunk[] = [];
  for await (const chunk of provider.generate(i)) out.push(chunk);
  return out;
}

const body = (call: Call) => JSON.parse(call.init.body as string) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("the request", () => {
  it("goes to the streaming endpoint of the chosen model with the key in a header, not in the address", async () => {
    const { provider, calls } = providerWith(() => sse([frame({ candidates: [{ content: { parts: [{ text: "ok" }] } }] })]));
    await collect(provider, input());
    expect(calls[0]!.url).toContain("/v1beta/models/gemini-test:streamGenerateContent");
    expect(calls[0]!.url).toContain("alt=sse");
    expect(calls[0]!.url).not.toContain(KEY);
    expect(new Headers(calls[0]!.init.headers).get("x-goog-api-key")).toBe(KEY);
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("sends the instruction, the dialogue and the token limit", async () => {
    const { provider, calls } = providerWith(() => sse([]));
    await collect(
      provider,
      input({
        messages: [
          { role: "user", text: "Привет" },
          { role: "model", text: "Здравствуйте" },
          { role: "user", text: "Температура?" },
        ],
        maxOutputTokens: 321,
      }),
    );
    const b = body(calls[0]!);
    expect(b.systemInstruction).toEqual({ parts: [{ text: "Be brief." }] });
    expect(b.contents).toEqual([
      { role: "user", parts: [{ text: "Привет" }] },
      { role: "model", parts: [{ text: "Здравствуйте" }] },
      { role: "user", parts: [{ text: "Температура?" }] },
    ]);
    expect(b.generationConfig.maxOutputTokens).toBe(321);
    expect(b.tools).toBeUndefined();
  });

  it("describes the tools with their JSON Schema", async () => {
    const parameters = { type: "object", properties: { source: { type: "string", enum: ["room", "street"] } }, required: ["source"] };
    const { provider, calls } = providerWith(() => sse([]));
    await collect(provider, input({ tools: [{ name: "get_current", description: "latest", parameters }] }));
    expect(body(calls[0]!).tools).toEqual([{ functionDeclarations: [{ name: "get_current", description: "latest", parametersJsonSchema: parameters }] }]);
  });

  it("gives a tool call back with its id and thought signature, and puts the results of one turn into one message", async () => {
    const { provider, calls } = providerWith(() => sse([]));
    await collect(
      provider,
      input({
        messages: [
          { role: "user", text: "Сравни" },
          {
            role: "model",
            toolCalls: [
              { id: "a", name: "get_current", args: { source: "room" }, signature: "SIG-A" },
              { id: "b", name: "get_current", args: { source: "street" } },
            ],
          },
          { role: "tool", toolResult: { id: "a", name: "get_current", content: '{"temperatureC":24.7}' } },
          { role: "tool", toolResult: { id: "b", name: "get_current", content: "Unknown source" } },
        ],
      }),
    );
    const contents = body(calls[0]!).contents;
    expect(contents).toHaveLength(3);
    expect(contents[1]).toEqual({
      role: "model",
      parts: [
        { functionCall: { name: "get_current", args: { source: "room" }, id: "a" }, thoughtSignature: "SIG-A" },
        { functionCall: { name: "get_current", args: { source: "street" }, id: "b" } },
      ],
    });
    expect(contents[2]).toEqual({
      role: "user",
      parts: [
        { functionResponse: { name: "get_current", id: "a", response: { result: { temperatureC: 24.7 } } } },
        { functionResponse: { name: "get_current", id: "b", response: { result: "Unknown source" } } },
      ],
    });
  });
});

describe("the answer", () => {
  it("streams text pieces and then the token count (answer plus thinking)", async () => {
    const { provider } = providerWith(() =>
      sse([
        frame({ candidates: [{ content: { parts: [{ text: "Сейчас " }] } }] }),
        frame({ candidates: [{ content: { parts: [{ text: "24,7 °C" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 5 } }),
      ]),
    );
    expect(await collect(provider, input())).toEqual([
      { type: "text", delta: "Сейчас " },
      { type: "text", delta: "24,7 °C" },
      { type: "usage", inputTokens: 100, outputTokens: 15 },
    ]);
  });

  it("skips empty text and the model's own thoughts", async () => {
    const { provider } = providerWith(() =>
      sse([frame({ candidates: [{ content: { parts: [{ text: "" }, { text: "думаю", thought: true }, { text: "Ответ" }] } }] })]),
    );
    expect(await collect(provider, input())).toEqual([{ type: "text", delta: "Ответ" }]);
  });

  it("turns function calls into one tool-calls chunk, keeping the ids and signatures", async () => {
    const { provider } = providerWith(() =>
      sse([
        frame({ candidates: [{ content: { parts: [{ functionCall: { name: "get_current", args: { source: "room" }, id: "c1" }, thoughtSignature: "SIG" }] } }] }),
        frame({ candidates: [{ content: { parts: [{ functionCall: { name: "get_current", args: { source: "street" }, id: "c2" } }] }, finishReason: "STOP" }] }),
      ]),
    );
    expect(await collect(provider, input())).toEqual([
      {
        type: "tool_calls",
        calls: [
          { id: "c1", name: "get_current", args: { source: "room" }, signature: "SIG" },
          { id: "c2", name: "get_current", args: { source: "street" } },
        ],
      },
    ]);
  });

  it("makes up an id for a call that comes without one", async () => {
    const { provider } = providerWith(() => sse([frame({ candidates: [{ content: { parts: [{ functionCall: { name: "get_current", args: {} } }] } }] })]));
    const [chunk] = await collect(provider, input());
    expect(chunk).toMatchObject({ type: "tool_calls", calls: [{ name: "get_current", id: expect.stringMatching(/.+/) }] });
  });

  it("reads an event that arrives in two pieces", async () => {
    const whole = frame({ candidates: [{ content: { parts: [{ text: "Привет" }] } }] });
    const { provider } = providerWith(() => sse([whole.slice(0, 20), whole.slice(20)]));
    expect(await collect(provider, input())).toEqual([{ type: "text", delta: "Привет" }]);
  });
});

describe("failures", () => {
  it("calls a 429 a quota error", async () => {
    const { provider } = providerWith(() => new Response('{"error":{"status":"RESOURCE_EXHAUSTED"}}', { status: 429 }));
    await expect(collect(provider, input())).rejects.toMatchObject({ name: "ProviderError", kind: "quota" });
  });

  it.each([400, 403, 404, 500, 503])("calls a %i an upstream error", async (status) => {
    const { provider } = providerWith(() => new Response("{}", { status }));
    await expect(collect(provider, input())).rejects.toMatchObject({ name: "ProviderError", kind: "upstream" });
  });

  it("does not put the key into the text of an error", async () => {
    const { provider } = providerWith(() => new Response(`{"error":{"message":"bad key ${KEY}"}}`, { status: 403 }));
    const error = (await collect(provider, input()).catch((e: unknown) => e)) as ProviderError;
    expect(error.message).not.toContain(KEY);
  });

  it("tries once more after a network error, and succeeds if the second try does", async () => {
    const { provider, calls } = providerWith((_call, n) => {
      if (n === 1) throw new TypeError("fetch failed");
      return sse([frame({ candidates: [{ content: { parts: [{ text: "ok" }] } }] })]);
    });
    expect(await collect(provider, input())).toEqual([{ type: "text", delta: "ok" }]);
    expect(calls).toHaveLength(2);
  });

  it("gives up with an upstream error after the second network error", async () => {
    const { provider, calls } = providerWith(() => {
      throw new TypeError("fetch failed");
    });
    await expect(collect(provider, input())).rejects.toMatchObject({ kind: "upstream" });
    expect(calls).toHaveLength(2);
  });

  it("does not try again after a refusal from the server", async () => {
    const { provider, calls } = providerWith(() => new Response("{}", { status: 500 }));
    await collect(provider, input()).catch(() => undefined);
    expect(calls).toHaveLength(1);
  });

  it("calls an answer without a body an upstream error", async () => {
    const { provider } = providerWith(() => new Response(null, { status: 200 }));
    await expect(collect(provider, input())).rejects.toMatchObject({ kind: "upstream" });
  });

  it("calls a model that never answers an upstream error after the time limit", async () => {
    const { provider } = providerWith((call) => new Promise<Response>((_resolve, reject) => {
      (call.init.signal as AbortSignal).addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }), { timeoutMs: 30, retryDelayMs: 0 });
    await expect(collect(provider, input())).rejects.toMatchObject({ kind: "upstream" });
  });
});

describe("cancelling", () => {
  it("ends quietly when the caller cancels before the answer starts", async () => {
    const controller = new AbortController();
    const { provider } = providerWith((call) => new Promise<Response>((_resolve, reject) => {
      (call.init.signal as AbortSignal).addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const done = collect(provider, input({ signal: controller.signal }));
    controller.abort();
    expect(await done).toEqual([]);
  });

  it("ends quietly and stops reading when the caller cancels in the middle of the stream", async () => {
    const controller = new AbortController();
    const { provider } = providerWith(() => sse([
      frame({ candidates: [{ content: { parts: [{ text: "a" }] } }] }),
      frame({ candidates: [{ content: { parts: [{ text: "b" }] } }] }),
    ]));
    const out: ProviderChunk[] = [];
    for await (const chunk of provider.generate(input({ signal: controller.signal }))) {
      out.push(chunk);
      controller.abort();
    }
    expect(out).toEqual([{ type: "text", delta: "a" }]);
  });
});
