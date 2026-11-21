import { describe, expect, it } from "vitest";
import { assertProviderAllowed } from "./guard.js";

describe("assertProviderAllowed", () => {
  it("refuses the fake provider in production", () => {
    expect(() => assertProviderAllowed({ NODE_ENV: "production", ASSISTANT_ENABLED: true, ASSISTANT_PROVIDER: "fake" })).toThrow(/fake/);
  });

  it("allows the fake provider in development and in tests", () => {
    for (const NODE_ENV of ["development", "test"] as const) {
      expect(() => assertProviderAllowed({ NODE_ENV, ASSISTANT_ENABLED: true, ASSISTANT_PROVIDER: "fake" })).not.toThrow();
    }
  });

  it("allows Gemini in production", () => {
    expect(() => assertProviderAllowed({ NODE_ENV: "production", ASSISTANT_ENABLED: true, ASSISTANT_PROVIDER: "gemini" })).not.toThrow();
  });

  it("refuses an enabled assistant without a provider choice", () => {
    expect(() => assertProviderAllowed({ NODE_ENV: "production", ASSISTANT_ENABLED: true, ASSISTANT_PROVIDER: undefined })).toThrow(/ASSISTANT_PROVIDER/);
  });

  it("does not care about the provider while the assistant is off", () => {
    expect(() => assertProviderAllowed({ NODE_ENV: "production", ASSISTANT_ENABLED: false, ASSISTANT_PROVIDER: "fake" })).not.toThrow();
  });
});
