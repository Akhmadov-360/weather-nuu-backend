import { describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "./rate-limiter.js";
import { createSharedRateLimiter, MemoryHitStore, PgHitStore, withFallback } from "./rate-store.js";

function shared(over: Partial<{ perMinute: number; perHour: number; globalPerMinute: number }> = {}, store = new MemoryHitStore()) {
  let now = Date.parse("2026-11-23T10:00:00Z");
  const limiter = createSharedRateLimiter(store, { perMinute: 4, perHour: 40, globalPerMinute: 6, now: () => now, ...over });
  return { limiter, store, advance: (ms: number) => void (now += ms) };
}

describe("the limiter over a shared store", () => {
  it("lets an address ask as often as the minute limit says and stops the next request, with a wait", async () => {
    const { limiter, advance } = shared();
    for (let i = 0; i < 4; i++) expect((await limiter.check("a")).ok).toBe(true);
    const blocked = await limiter.check("a");
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
    advance(61_000);
    expect((await limiter.check("a")).ok).toBe(true);
  });

  it("applies the hour limit and the ceiling for the whole service", async () => {
    const hour = shared({ perMinute: 100, perHour: 3, globalPerMinute: 100 });
    for (let i = 0; i < 3; i++) await hour.limiter.check("a");
    const blocked = await hour.limiter.check("a");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBeGreaterThan(60);

    const global = shared({ perMinute: 100, perHour: 100, globalPerMinute: 3 });
    for (const key of ["a", "b", "c"]) expect((await global.limiter.check(key)).ok).toBe(true);
    expect((await global.limiter.check("d")).ok).toBe(false);
  });

  it("does not record a refused request", async () => {
    const { limiter, advance } = shared({ perMinute: 1 });
    await limiter.check("a");
    for (let i = 0; i < 5; i++) await limiter.check("a");
    advance(61_000);
    expect((await limiter.check("a")).ok).toBe(true);
    expect((await limiter.check("a")).ok).toBe(false);
  });

  it("counts for two limiters that share one store, as two API processes would", async () => {
    const store = new MemoryHitStore();
    const first = shared({ perMinute: 3 }, store).limiter;
    const second = shared({ perMinute: 3 }, store).limiter;
    await first.check("a");
    await second.check("a");
    await first.check("a");
    expect((await second.check("a")).ok).toBe(false);
  });

  it("does not let concurrent requests slip past the limit", async () => {
    const { limiter } = shared({ perMinute: 3, globalPerMinute: 100 });
    const results = await Promise.all(Array.from({ length: 10 }, () => limiter.check("a")));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
  });

  it("behaves like the limiter in memory on the same requests", async () => {
    let now = Date.parse("2026-11-23T10:00:00Z");
    const options = { perMinute: 3, perHour: 5, globalPerMinute: 4, now: () => now };
    const memory = createRateLimiter(options);
    const store = createSharedRateLimiter(new MemoryHitStore(), options);
    for (const [key, step] of [["a", 0], ["a", 10], ["b", 10], ["a", 10], ["a", 10], ["b", 10], ["c", 40_000], ["a", 20_000], ["a", 60_000]] as const) {
      now += step;
      expect((await store.check(key)).ok, `${key} at ${now}`).toBe(memory.check(key).ok);
    }
  });

  it("forgets old requests so the store does not grow for ever", async () => {
    const { limiter, store, advance } = shared();
    await limiter.check("a");
    advance(2 * 3_600_000);
    await limiter.check("b");
    let left = -1;
    await store.transaction(async (tx) => void (left = (await tx.globalHits(0)).length));
    expect(left).toBe(1);
  });
});

describe("withFallback", () => {
  it("counts in memory when the shared store fails, and tells about it", async () => {
    const onError = vi.fn();
    const broken = { check: async () => { throw new Error("db down"); } };
    const local = createRateLimiter({ perMinute: 1, perHour: 10, globalPerMinute: 10 });
    const limiter = withFallback(broken, local, onError);
    expect((await limiter.check("a")).ok).toBe(true);
    expect((await limiter.check("a")).ok).toBe(false);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("uses the shared store when it works", async () => {
    const local = { check: vi.fn(() => ({ ok: true as const })) };
    const limiter = withFallback({ check: async () => ({ ok: false as const, retryAfterSeconds: 5 }) }, local, vi.fn());
    expect(await limiter.check("a")).toEqual({ ok: false, retryAfterSeconds: 5 });
    expect(local.check).not.toHaveBeenCalled();
  });
});

describe("PgHitStore", () => {
  function fakePool(rows: Record<string, { t: string }[]> = {}) {
    const calls: { sql: string; params?: unknown[] }[] = [];
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        calls.push({ sql, ...(params ? { params } : {}) });
        const hit = Object.entries(rows).find(([needle]) => sql.includes(needle));
        return { rows: hit ? hit[1] : [] };
      }),
      release: vi.fn(),
    };
    return { pool: { connect: async () => client } as never, calls, client };
  }

  it("takes the advisory lock first, commits, and gives the connection back", async () => {
    const { pool, calls, client } = fakePool({ "AND at >=": [{ t: "1000" }, { t: "2000" }] });
    const result = await new PgHitStore(pool).transaction(async (tx) => tx.keyHits("a", 0));
    expect(result).toEqual([1000, 2000]);
    expect(calls.map((c) => c.sql.split(" ")[0])).toEqual(["BEGIN", "SELECT", "SELECT", "COMMIT"]);
    expect(calls[1]!.sql).toContain("pg_advisory_xact_lock");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("writes and deletes with parameters, never with the values in the text of the query", async () => {
    const { pool, calls } = fakePool();
    await new PgHitStore(pool).transaction(async (tx) => {
      await tx.add("1.2.3.4'; DROP TABLE x;--", 5000);
      await tx.prune(1000);
    });
    const insert = calls.find((c) => c.sql.startsWith("INSERT"))!;
    expect(insert.sql).not.toContain("DROP");
    expect(insert.params).toEqual(["1.2.3.4'; DROP TABLE x;--", 5000]);
    expect(calls.find((c) => c.sql.startsWith("DELETE"))!.params).toEqual([1000]);
  });

  it("rolls back and releases the connection when something fails", async () => {
    const { pool, calls, client } = fakePool();
    await expect(new PgHitStore(pool).transaction(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(calls.map((c) => c.sql)).toContain("ROLLBACK");
    expect(calls.map((c) => c.sql)).not.toContain("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });
});
