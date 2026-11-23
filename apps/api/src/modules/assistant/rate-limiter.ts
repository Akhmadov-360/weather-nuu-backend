const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export type RateLimiter = {
  /** Counts the request if it is allowed. A refused request is not counted, so refusing is free. */
  check(key: string): RateLimitResult | Promise<RateLimitResult>;
};

/**
 * Sliding windows in memory: per address a minute limit and an hour limit, and one ceiling per minute for
 * the whole service (the free quota of the model is shared by every visitor). One API process only; with
 * several replicas the counters would have to move to a shared store.
 */
export function createRateLimiter(options: {
  perMinute: number;
  perHour: number;
  globalPerMinute: number;
  now?: () => number;
}): { check(key: string): RateLimitResult } {
  const now = options.now ?? Date.now;
  const byKey = new Map<string, number[]>();
  let global: number[] = [];

  const wait = (oldest: number, windowMs: number, at: number) => Math.max(1, Math.ceil((oldest + windowMs - at) / 1000));

  return {
    check(key) {
      const at = now();
      global = global.filter((t) => at - t < MINUTE_MS);
      const mine = (byKey.get(key) ?? []).filter((t) => at - t < HOUR_MS);

      const lastMinute = mine.filter((t) => at - t < MINUTE_MS);
      if (lastMinute.length >= options.perMinute) {
        byKey.set(key, mine);
        return { ok: false, retryAfterSeconds: wait(lastMinute[0]!, MINUTE_MS, at) };
      }
      if (mine.length >= options.perHour) {
        byKey.set(key, mine);
        return { ok: false, retryAfterSeconds: wait(mine[0]!, HOUR_MS, at) };
      }
      if (global.length >= options.globalPerMinute) {
        byKey.set(key, mine);
        return { ok: false, retryAfterSeconds: wait(global[0]!, MINUTE_MS, at) };
      }

      mine.push(at);
      byKey.set(key, mine);
      global.push(at);

      // Forget addresses that have been quiet for an hour, so the map does not grow for ever.
      if (byKey.size > 5000) {
        for (const [k, times] of byKey) if (times.every((t) => at - t >= HOUR_MS)) byKey.delete(k);
      }
      return { ok: true };
    },
  };
}
