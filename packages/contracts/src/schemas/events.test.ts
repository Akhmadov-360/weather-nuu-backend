import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVENTS_MAX_DAYS, EventsQuerySchema, EventsResponseSchema } from "./events.js";

const example = JSON.parse(readFileSync(new URL("./events.example.json", import.meta.url), "utf8")) as { query: unknown; response: unknown };

describe("events contract", () => {
  it("accepts the documented request and response", () => {
    expect(EventsQuerySchema.safeParse(example.query).success).toBe(true);
    expect(EventsResponseSchema.safeParse(example.response).success).toBe(true);
  });

  it("rejects a period that is backwards, empty or longer than the limit", () => {
    expect(EventsQuerySchema.safeParse({ from: "2026-11-23T10:00:00Z", to: "2026-11-23T09:00:00Z" }).success).toBe(false);
    expect(EventsQuerySchema.safeParse({ from: "2026-11-23T10:00:00Z", to: "2026-11-23T10:00:00Z" }).success).toBe(false);
    expect(EventsQuerySchema.safeParse({ from: "2026-11-01T00:00:00Z", to: "2026-11-01T00:00:00Z" }).success).toBe(false);
    const day = 86_400_000;
    const from = Date.parse("2026-11-01T00:00:00Z");
    expect(EventsQuerySchema.safeParse({ from: new Date(from).toISOString(), to: new Date(from + EVENTS_MAX_DAYS * day).toISOString() }).success).toBe(true);
    expect(EventsQuerySchema.safeParse({ from: new Date(from).toISOString(), to: new Date(from + EVENTS_MAX_DAYS * day + 1000).toISOString() }).success).toBe(false);
  });

  it("rejects an unknown class and a response without the method", () => {
    const response = example.response as { events: object[] };
    expect(EventsResponseSchema.safeParse({ ...response, events: [{ ...response.events[0], cls: "heating" }] }).success).toBe(false);
    expect(EventsResponseSchema.safeParse({ ...response, method: undefined }).success).toBe(false);
  });
});
