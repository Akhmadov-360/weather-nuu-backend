import { z } from "zod";

/** Limits are part of the contract: the client trims to them, the server enforces them. */
export const MESSAGE_MAX_CHARS = 1000;
export const HISTORY_MAX_MESSAGES = 10;
export const HISTORY_MAX_CHARS = 6000;

export const AssistantLangSchema = z.enum(["ru", "uz", "en"]);
export type AssistantLang = z.infer<typeof AssistantLangSchema>;

/** The page the question is asked from. */
export const AssistantContextSchema = z.enum(["room", "street"]);
export type AssistantContext = z.infer<typeof AssistantContextSchema>;

/**
 * A turn of the dialogue as the client remembers it. Only what people and the assistant said:
 * there is no "tool" role, so a client cannot pass off an invented tool result as data.
 */
export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(HISTORY_MAX_CHARS),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatRequestSchema = z.object({
  message: z.string().min(1).max(MESSAGE_MAX_CHARS),
  history: z
    .array(ChatMessageSchema)
    .max(HISTORY_MAX_MESSAGES)
    .refine((items) => items.reduce((sum, item) => sum + item.content.length, 0) <= HISTORY_MAX_CHARS, {
      message: `history is longer than ${HISTORY_MAX_CHARS} characters in total`,
    })
    .default([]),
  lang: AssistantLangSchema,
  context: AssistantContextSchema,
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/** The server sends a code only; the interface turns it into text in the visitor's language. */
export const AssistantErrorCodeSchema = z.enum([
  "disabled",
  "rate_limited",
  "quota",
  "upstream",
  "bad_request",
  "internal",
]);
export type AssistantErrorCode = z.infer<typeof AssistantErrorCodeSchema>;

export const AssistantCitationSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string(),
  /** Where the source can be read, when it has an address. */
  url: z.string().optional(),
});
export type AssistantCitation = z.infer<typeof AssistantCitationSchema>;

/** One event of the answer stream (Server-Sent Events: `event: <type>`, `data: <json>`). */
export const AssistantEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), delta: z.string() }),
  z.object({ type: z.literal("tool_start"), id: z.string(), name: z.string() }),
  z.object({ type: z.literal("tool_end"), id: z.string(), name: z.string(), ok: z.boolean() }),
  z.object({ type: z.literal("citations"), items: z.array(AssistantCitationSchema) }),
  z.object({ type: z.literal("done"), inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }),
  z.object({ type: z.literal("error"), code: AssistantErrorCodeSchema }),
]);
export type AssistantEvent = z.infer<typeof AssistantEventSchema>;

export const AssistantStatusSchema = z.object({ enabled: z.boolean() });
export type AssistantStatus = z.infer<typeof AssistantStatusSchema>;
