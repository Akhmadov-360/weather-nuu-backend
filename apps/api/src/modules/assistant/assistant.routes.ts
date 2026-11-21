import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AssistantStatusSchema, ChatRequestSchema, type AssistantEvent } from "@weather/contracts";
import { runAgent } from "./agent-loop.js";
import { buildSystemPrompt, exhaustedMessage, PROMPT_VERSION } from "./prompt.js";
import type { ChatProvider, ProviderMessage } from "./providers/types.js";
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
};

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
      const verdict = deps.limiter.check(clientKey(request));
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

      try {
        for await (const event of runAgent({
          provider,
          registry: deps.registry,
          system: buildSystemPrompt({ lang, context, now }),
          history: dialogue,
          message,
          maxOutputTokens: deps.maxOutputTokens,
          exhaustedMessage: exhaustedMessage(lang),
          signal: controller.signal,
          ctx: { now },
        })) {
          if (raw.destroyed || raw.writableEnded) break;
          if (event.type === "tool_start") tools.push(event.name);
          if (event.type === "done") {
            outcome = "done";
            inputTokens = event.inputTokens;
            outputTokens = event.outputTokens;
          }
          if (event.type === "error") outcome = "error";
          raw.write(sse(event));
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
          { assistant: { lang, context, tools, latencyMs: Date.now() - started, inputTokens, outputTokens, promptVersion: PROMPT_VERSION, outcome } },
          "assistant request",
        );
      }
    });
  };
}
