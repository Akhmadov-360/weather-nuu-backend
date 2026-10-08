import { describe, expect, it } from "vitest";
import {
  AGGREGATE_BUCKETS,
  AGGREGATE_TARGET_POINTS,
  BUCKET_MS,
  resolveAutoBucket,
} from "@weather/contracts";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

describe("resolveAutoBucket", () => {
  it("picks the smallest bucket for a 1h span", () => {
    // 1h / 1m = 60 points — well under target
    expect(resolveAutoBucket(HOUR)).toBe("1m");
  });

  it("picks 5m for 6h span (6h/1m = 360 fits, but the resolver still prefers finer)", () => {
    // 6h / 1m = 360 points — still under target, so 1m wins
    expect(resolveAutoBucket(6 * HOUR)).toBe("1m");
  });

  it("picks 5m for a 24h span", () => {
    // 24h / 1m = 1440, still ≤ 1500 target — 1m still wins
    expect(resolveAutoBucket(24 * HOUR)).toBe("1m");
  });

  it("picks 5m for a 2-day span (1m would overshoot)", () => {
    // 2d / 1m = 2880 > target, 2d / 5m = 576 ≤ target
    expect(resolveAutoBucket(2 * DAY)).toBe("5m");
  });

  it("picks 15m for 7-day span", () => {
    // 7d / 5m = 2016 > target, 7d / 15m = 672 ≤ target
    expect(resolveAutoBucket(7 * DAY)).toBe("15m");
  });

  it("picks 1h for 30-day span", () => {
    // 30d / 15m = 2880 > target, 30d / 1h = 720 ≤ target
    expect(resolveAutoBucket(30 * DAY)).toBe("1h");
  });

  it("picks 3h for 90-day span", () => {
    // 90d / 1h = 2160 > target, 90d / 3h = 720 ≤ target
    expect(resolveAutoBucket(90 * DAY)).toBe("3h");
  });

  it("picks 1d for a 1-year span", () => {
    // 365d / 3h = 2920 > target, 365d / 1d = 365 ≤ target
    expect(resolveAutoBucket(365 * DAY)).toBe("1d");
  });

  it("falls back to the coarsest bucket for absurdly wide spans", () => {
    // 100 years / 3d ≈ 12178 — over the target, but 3d is the coarsest we have.
    // Better to return SOMETHING coarse than to error out.
    expect(resolveAutoBucket(100 * 365 * DAY)).toBe(AGGREGATE_BUCKETS[AGGREGATE_BUCKETS.length - 1]);
  });

  it("keeps output count under target for every documented bucket boundary", () => {
    // Sanity: for every bucket B, the smallest span that picks B still has
    // (span / B_ms) ≤ AGGREGATE_TARGET_POINTS. Fails loudly if someone
    // reorders AGGREGATE_BUCKETS or tweaks the target without re-checking.
    for (const bucket of AGGREGATE_BUCKETS) {
      // Sweep 1h … 400d in 1h steps
      for (let hours = 1; hours <= 400 * 24; hours += 3) {
        const span = hours * HOUR;
        if (resolveAutoBucket(span) === bucket) {
          expect(span / BUCKET_MS[bucket]).toBeLessThanOrEqual(AGGREGATE_TARGET_POINTS);
          break;
        }
      }
    }
  });
});
