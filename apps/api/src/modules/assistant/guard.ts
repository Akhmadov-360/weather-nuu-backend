export type ProviderSettings = {
  NODE_ENV: "development" | "test" | "production";
  ASSISTANT_ENABLED: boolean;
  ASSISTANT_PROVIDER?: "fake" | "gemini" | undefined;
};

/**
 * Called before the server starts listening. An enabled assistant must name its provider, and the
 * scripted fake one must never run in production (it would answer visitors with canned text).
 */
export function assertProviderAllowed(settings: ProviderSettings): void {
  if (!settings.ASSISTANT_ENABLED) return;
  if (!settings.ASSISTANT_PROVIDER) {
    throw new Error("ASSISTANT_ENABLED is true but ASSISTANT_PROVIDER is not set (use fake or gemini)");
  }
  if (settings.NODE_ENV === "production" && settings.ASSISTANT_PROVIDER === "fake") {
    throw new Error("ASSISTANT_PROVIDER=fake is not allowed in production");
  }
}
