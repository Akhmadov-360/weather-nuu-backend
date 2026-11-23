import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AssistantStatusSchema, ChatRequestSchema, type AssistantCitation, type AssistantEvent } from "@weather/contracts";
import { AnswerCache, cacheKey } from "./answer-cache.js";
import { runAgent } from "./agent-loop.js";
import { findUnverifiedNumbers } from "./verify-numbers.js";
import { buildSystemPrompt, exhaustedMessage, PROMPT_VERSION } from "./prompt.js";
import { ProviderError, type ChatProvider, type ProviderMessage } from "./providers/types.js";
import type { RateLimiter } from "./rate-limiter.js";
import type { ToolRegistry } from "./tools/registry.js";

export type AssistantDeps = {
  enabled: boolean;
  /** `null`: nothing to ask (no key, or the provider is not wired yet). */
  provider: ChatProvider | null;
  registry: ToolRegistry;
  limiter: RateLimiter;
  maxOutputTokens: number;
  now: () => Date;
  /** How often a silent stream sends a `: ping` comment. */
  pingMs: number;
  /** Answers that do not depend on the readings, kept for a while. Off when absent. */
  cache?: AnswerCache;
};

/** A kept answer is played back in pieces, so that it arrives the way a new one does. */
async function* replay(events: AssistantEvent[], signal: AbortSignal): AsyncGenerator<AssistantEvent> {
  for (const event of events) {
    if (signal.aborted) return;
    yield event;
    if (event.type === "text") await new Promise((resolve) => setTimeout(resolve, 12));
  }
}

/** Only the tools whose answer does not change with the readings. */
const STABLE_TOOLS = new Set(["search_knowledge"]);

/** The address behind nginx: `X-Real-IP` is set by nginx itself, unlike `X-Forwarded-For`, which a visitor can write. */
function clientKey(request: FastifyRequest): string {
  const real = request.headers["x-real-ip"];
  return (Array.isArray(real) ? real[0] : real) ?? request.ip;
}

/** What earlier plugins put on the reply (CORS), as plain headers for the hand-written response. */
function headersSoFar(reply: FastifyReply): Record<string, string | number | string[]> {
  const out: Record<string, string | number | string[]> = {};
  for (const [name, value] of Object.entries(reply.getHeaders())) if (value !== undefined) out[name] = value;
  return out;
}

function sse(event: AssistantEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** The routes with their dependencies passed in, so tests can run them with a scripted model and no database. */
export function createAssistantRoutes(deps: AssistantDeps): FastifyPluginAsyncZod {
  return async (app) => {
    app.get("/v1/assistant/status", { schema: { response: { 200: AssistantStatusSchema } } }, async () => ({
      enabled: deps.enabled && deps.provider !== null,
    }));

    app.post("/v1/assistant/chat", { schema: { body: ChatRequestSchema } }, async (request, reply) => {
      const provider = deps.provider;
      if (!deps.enabled || !provider) {
        return reply.status(503).send({ error: { code: "disabled", message: "The assistant is not available" } });
      }
      const verdict = await deps.limiter.check(clientKey(request));
      if (!verdict.ok) {
        return reply
          .header("retry-after", String(verdict.retryAfterSeconds))
          .status(429)
          .send({ error: { code: "rate_limited", message: "Too many questions, try again later" } });
      }

      const { message, history, lang, context } = request.body;
      const now = deps.now();
      // Only what people and the assistant said: no tool calls or tool results can arrive from the client.
      const dialogue: ProviderMessage[] = history.map((m) => ({ role: m.role === "user" ? "user" : "model", text: m.content }));

      const controller = new AbortController();
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        // Keeps what plugins set earlier (CORS), then the stream headers.
        ...headersSoFar(reply),
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      raw.flushHeaders();
      raw.on("close", () => controller.abort());
      const ping = setInterval(() => {
        if (!raw.destroyed && !raw.writableEnded) raw.write(": ping\n\n");
      }, deps.pingMs);

      const started = Date.now();
      const tools: string[] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      let outcome: "done" | "error" | "cancelled" = "cancelled";
      let answer = "";
      const toolResults: string[] = [];
      let providerError: { kind: string; status?: number } | undefined;
      // The sources the tools used, shown with the answer; the same fragment found twice is shown once.
      const citations = new Map<string, AssistantCitation>();
      const knowledge = deps.registry.specs().some((spec) => spec.name === "search_knowledge");
      // A question with no earlier turns may be answered from the cache, and its answer may go into it.
      const key = deps.cache?.enabled && history.length === 0 ? cacheKey(lang, message) : null;
      const cached = key ? deps.cache!.get(key) : null;
      const sent: AssistantEvent[] = [];
      let unverified: string[] = [];

      try {
        const events = cached ? replay(cached, controller.signal) : runAgent({
          provider,
          registry: deps.registry,
          system: buildSystemPrompt({ lang, context, now, knowledge }),
          history: dialogue,
          message,
          maxOutputTokens: deps.maxOutputTokens,
          exhaustedMessage: exhaustedMessage(lang),
          signal: controller.signal,
          ctx: {
            now,
            onCitations: (items) => {
              for (const item of items) citations.set(item.id, item);
            },
          },
          onToolResult: (_name, result) => {
            if (result.ok) toolResults.push(result.content);
          },
          onProviderError: (error) => {
            providerError = error instanceof ProviderError ? { kind: error.kind, ...(error.status ? { status: error.status } : {}) } : { kind: "unknown" };
          },
        });
        for await (const event of events) {
          if (raw.destroyed || raw.writableEnded) break;
          if (event.type === "tool_start") tools.push(event.name);
          if (event.type === "text") answer += event.delta;
          if (event.type === "done" && !cached && citations.size) {
            const sources: AssistantEvent = { type: "citations", items: [...citations.values()] };
            sent.push(sources);
            raw.write(sse(sources));
          }
          if (event.type === "done") {
            outcome = "done";
            inputTokens = event.inputTokens;
            outputTokens = event.outputTokens;
          }
          if (event.type === "error") outcome = "error";
          sent.push(event);
          raw.write(sse(event));
        }
        if (outcome === "done" && !cached) {
          unverified = findUnverifiedNumbers(answer, toolResults, [message, ...history.map((m) => m.content)].join(" "));
          // A verified answer that does not depend on the readings is kept for the next person who asks the same.
          if (key && unverified.length === 0 && tools.every((t) => STABLE_TOOLS.has(t))) deps.cache!.set(key, sent);
        }
      } catch (error) {
        outcome = "error";
        request.log.error({ err: error }, "assistant stream failed");
        if (!raw.destroyed && !raw.writableEnded) raw.write(sse({ type: "error", code: "internal" }));
      } finally {
        clearInterval(ping);
        if (!raw.writableEnded) raw.end();
        // The question itself is not logged: it may contain what the visitor should not have written.
        request.log.info(
          {
            assistant: {
              lang,
              context,
              tools,
              ...(citations.size ? { sources: [...citations.keys()] } : {}),
              latencyMs: Date.now() - started,
              inputTokens,
              outputTokens,
              promptVersion: PROMPT_VERSION,
              outcome,
              ...(cached ? { cache: "hit" } : {}),
              ...(provider.usageSnapshot ? { models: provider.usageSnapshot() } : {}),
              ...(providerError ? { providerError } : {}),
              // Figures in the answer that no tool returned (a signal for the evaluation; the visitor is not told).
              ...(outcome === "done" && !cached ? { unverifiedNumbers: unverified } : {}),
            },
          },
          "assistant request",
        );
      }
    });
  };
}
