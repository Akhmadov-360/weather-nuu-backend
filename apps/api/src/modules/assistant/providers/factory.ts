import { CapacityProvider, type CapacityEvent } from "./capacity.js";
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
  /** A second model for the time when the first one is out of quota. */
  ASSISTANT_FALLBACK_MODEL?: string | undefined;
  /** Requests a day that the key allows for each of the models. */
  ASSISTANT_DAILY_LIMIT?: number | undefined;
  ASSISTANT_FALLBACK_DAILY_LIMIT?: number | undefined;
}, onEvent?: (event: CapacityEvent) => void): ChatProvider | null {
  if (settings.ASSISTANT_PROVIDER === "fake") return createDevProvider();
  if (settings.ASSISTANT_PROVIDER === "gemini" && settings.GEMINI_API_KEY && settings.ASSISTANT_MODEL) {
    const gemini = (model: string) => new GeminiChatProvider({ apiKey: settings.GEMINI_API_KEY!, model });
    const slots = [{ name: settings.ASSISTANT_MODEL, provider: gemini(settings.ASSISTANT_MODEL), ...(settings.ASSISTANT_DAILY_LIMIT ? { dailyLimit: settings.ASSISTANT_DAILY_LIMIT } : {}) }];
    if (settings.ASSISTANT_FALLBACK_MODEL && settings.ASSISTANT_FALLBACK_MODEL !== settings.ASSISTANT_MODEL) {
      slots.push({ name: settings.ASSISTANT_FALLBACK_MODEL, provider: gemini(settings.ASSISTANT_FALLBACK_MODEL), ...(settings.ASSISTANT_FALLBACK_DAILY_LIMIT ? { dailyLimit: settings.ASSISTANT_FALLBACK_DAILY_LIMIT } : {}) });
    }
    return new CapacityProvider(slots, onEvent ? { onEvent } : {});
  }
  return null;
}
