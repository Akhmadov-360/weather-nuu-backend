import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limiter.js";

function setup(over: Partial<{ perMinute: number; perHour: number; globalPerMinute: number }> = {}) {
  let now = Date.parse("2026-11-21T10:00:00Z");
  const limiter = createRateLimiter({ perMinute: 10, perHour: 60, globalPerMinute: 20, now: () => now, ...over });
  return { limiter, advance: (ms: number) => void (now += ms) };
}

describe("createRateLimiter", () => {
  it("lets one address ask ten times a minute and stops the eleventh", () => {
    const { limiter } = setup();
    for (let i = 0; i < 10; i++) expect(limiter.check("1.1.1.1").ok, `request ${i + 1}`).toBe(true);
    const blocked = limiter.check("1.1.1.1");
    expect(blocked.ok).toBe(false);
  });

  it("says how long to wait, and lets the address in again after that", () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 10; i++) limiter.check("1.1.1.1");
    const blocked = limiter.check("1.1.1.1");
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
    advance(61_000);
    expect(limiter.check("1.1.1.1").ok).toBe(true);
  });

  it("keeps addresses apart", () => {
    const { limiter } = setup();
    for (let i = 0; i < 10; i++) limiter.check("1.1.1.1");
    expect(limiter.check("2.2.2.2").ok).toBe(true);
  });

  it("stops an address at sixty an hour even if it keeps within ten a minute", () => {
    const { limiter, advance } = setup();
    let allowed = 0;
    for (let i = 0; i < 80; i++) {
      if (limiter.check("1.1.1.1").ok) allowed++;
      advance(7_000); // about 8.5 a minute: under the minute limit
    }
    expect(allowed).toBe(60);
  });

  it("has one ceiling for the whole service across addresses", () => {
    const { limiter } = setup();
    let allowed = 0;
    for (let i = 0; i < 30; i++) if (limiter.check(`10.0.0.${i}`).ok) allowed++;
    expect(allowed).toBe(20);
  });

  it("does not use up the ceiling with requests it refused", () => {
    const { limiter, advance } = setup({ globalPerMinute: 12 });
    for (let i = 0; i < 10; i++) limiter.check("1.1.1.1");
    for (let i = 0; i < 50; i++) limiter.check("1.1.1.1"); // all refused
    expect(limiter.check("2.2.2.2").ok).toBe(true);
    expect(limiter.check("3.3.3.3").ok).toBe(true);
    expect(limiter.check("4.4.4.4").ok).toBe(false);
    advance(61_000);
    expect(limiter.check("4.4.4.4").ok).toBe(true);
  });
});
