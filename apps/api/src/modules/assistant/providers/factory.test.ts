import { describe, expect, it } from "vitest";
import { createProvider } from "./factory.js";
import { GeminiChatProvider } from "./gemini.js";

describe("createProvider", () => {
  it("gives the scripted provider for fake", () => {
    expect(createProvider({ ASSISTANT_PROVIDER: "fake" })).not.toBeNull();
  });

  it("gives Gemini when the key and the model name are set", () => {
    expect(createProvider({ ASSISTANT_PROVIDER: "gemini", GEMINI_API_KEY: "k", ASSISTANT_MODEL: "m" })).toBeInstanceOf(GeminiChatProvider);
  });

  it("gives nothing for Gemini without a key or without a model name: the assistant then reports 503", () => {
    expect(createProvider({ ASSISTANT_PROVIDER: "gemini", ASSISTANT_MODEL: "m" })).toBeNull();
    expect(createProvider({ ASSISTANT_PROVIDER: "gemini", GEMINI_API_KEY: "k" })).toBeNull();
  });

  it("gives nothing when no provider is chosen", () => {
    expect(createProvider({})).toBeNull();
  });
});
