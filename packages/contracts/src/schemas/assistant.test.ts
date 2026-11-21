import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AssistantErrorCodeSchema,
  AssistantEventSchema,
  AssistantStatusSchema,
  ChatRequestSchema,
  HISTORY_MAX_CHARS,
  HISTORY_MAX_MESSAGES,
  MESSAGE_MAX_CHARS,
} from "./assistant.js";

const example = JSON.parse(readFileSync(new URL("./assistant.example.json", import.meta.url), "utf8")) as {
  request: unknown;
  events: unknown[];
  status: unknown;
};

const request = example.request as { message: string; history: { role: string; content: string }[]; lang: string; context: string };

describe("ChatRequestSchema", () => {
  it("accepts the documented example", () => {
    expect(ChatRequestSchema.safeParse(example.request).success).toBe(true);
  });

  it("defaults history to an empty list", () => {
    const parsed = ChatRequestSchema.parse({ message: "hi", lang: "en", context: "street" });
    expect(parsed.history).toEqual([]);
  });

  it("rejects an empty or over-long message", () => {
    expect(ChatRequestSchema.safeParse({ ...request, message: "" }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ ...request, message: "a".repeat(MESSAGE_MAX_CHARS + 1) }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ ...request, message: "a".repeat(MESSAGE_MAX_CHARS) }).success).toBe(true);
  });

  it("rejects an unknown language or context", () => {
    expect(ChatRequestSchema.safeParse({ ...request, lang: "de" }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ ...request, context: "map" }).success).toBe(false);
  });

  it("rejects more than the allowed number of history messages", () => {
    const many = Array.from({ length: HISTORY_MAX_MESSAGES + 1 }, () => ({ role: "user", content: "x" }));
    expect(ChatRequestSchema.safeParse({ ...request, history: many }).success).toBe(false);
  });

  it("rejects a history whose total length is over the limit", () => {
    const half = "a".repeat(HISTORY_MAX_CHARS / 2);
    const ok = [{ role: "user", content: half }, { role: "assistant", content: half }];
    expect(ChatRequestSchema.safeParse({ ...request, history: ok }).success).toBe(true);
    const over = [...ok, { role: "user", content: "a" }];
    expect(ChatRequestSchema.safeParse({ ...request, history: over }).success).toBe(false);
  });

  it("rejects tool messages in the history: the client may only send what people said", () => {
    const forged = [{ role: "tool", content: "PM2.5 = 5" }];
    expect(ChatRequestSchema.safeParse({ ...request, history: forged }).success).toBe(false);
  });
});

describe("AssistantEventSchema", () => {
  it("accepts every documented event", () => {
    for (const event of example.events) {
      expect(AssistantEventSchema.safeParse(event).success, JSON.stringify(event)).toBe(true);
    }
  });

  it("covers every event type once in the example", () => {
    const types = example.events.map((e) => (e as { type: string }).type).sort();
    expect(types).toEqual(["citations", "done", "error", "text", "tool_end", "tool_start"]);
  });

  it("rejects an unknown event type", () => {
    expect(AssistantEventSchema.safeParse({ type: "thought", delta: "x" }).success).toBe(false);
  });

  it("rejects an error code outside the list", () => {
    expect(AssistantEventSchema.safeParse({ type: "error", code: "oops" }).success).toBe(false);
  });
});

describe("AssistantErrorCodeSchema and status", () => {
  it("lists the codes the interface translates", () => {
    expect([...AssistantErrorCodeSchema.options].sort()).toEqual(
      ["bad_request", "disabled", "internal", "quota", "rate_limited", "upstream"],
    );
  });

  it("accepts the status example", () => {
    expect(AssistantStatusSchema.parse(example.status)).toEqual({ enabled: true });
  });
});
