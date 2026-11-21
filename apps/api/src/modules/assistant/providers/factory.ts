import type { ChatProvider } from "./types.js";
import { createDevProvider } from "./dev.js";
import { GeminiChatProvider } from "./gemini.js";

/**
 * The provider the settings ask for, or `null` when there is none to use: the assistant is then reported
 * as unavailable (503) and the rest of the API works. Gemini needs both a key and a model name (names
 * change, so none is built in).
 */
export function createProvider(settings: {
  ASSISTANT_PROVIDER?: "fake" | "gemini" | undefined;
  GEMINI_API_KEY?: string | undefined;
  ASSISTANT_MODEL?: string | undefined;
}): ChatProvider | null {
  if (settings.ASSISTANT_PROVIDER === "fake") return createDevProvider();
  if (settings.ASSISTANT_PROVIDER === "gemini" && settings.GEMINI_API_KEY && settings.ASSISTANT_MODEL) {
    return new GeminiChatProvider({ apiKey: settings.GEMINI_API_KEY, model: settings.ASSISTANT_MODEL });
  }
  return null;
}
