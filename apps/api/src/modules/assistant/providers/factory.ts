import type { ChatProvider } from "./types.js";
import { createDevProvider } from "./dev.js";

/**
 * The provider the settings ask for, or `null` when there is none to use: the assistant is then reported
 * as unavailable (503) and the rest of the API works. Gemini is wired in task B7, when the key and the
 * model name have been checked; until then asking for it gives `null` and a warning at start.
 */
export function createProvider(settings: { ASSISTANT_PROVIDER?: "fake" | "gemini" | undefined }): ChatProvider | null {
  if (settings.ASSISTANT_PROVIDER === "fake") return createDevProvider();
  return null;
}
