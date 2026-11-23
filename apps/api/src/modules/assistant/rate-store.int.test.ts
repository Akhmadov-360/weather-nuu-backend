import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../db/client.js";
import { resetTables } from "../../test-utils/test-database.js";
import { createSharedRateLimiter, PgHitStore } from "./rate-store.js";

/** The shared limiter on a real Postgres: the table of the migration, the advisory lock and the time arithmetic of the queries. */
beforeEach(async () => {
  await resetTables(pool);
});
afterAll(async () => {
  await pool.end();
});

const T0 = Date.parse("2026-11-23T10:00:00Z");

describe("PgHitStore", () => {
  it("returns the times of the requests of an address, oldest first, to the millisecond", async () => {
    const store = new PgHitStore(pool);
    await store.transaction(async (tx) => {
      await tx.add("a", T0 + 2500);
      await tx.add("a", T0 + 500);
      await tx.add("b", T0 + 1000);
    });
    const [mine, all] = await store.transaction(async (tx) => [await tx.keyHits("a", T0), await tx.globalHits(T0)] as const);
    expect(mine).toEqual([T0 + 500, T0 + 2500]);
    expect(all).toEqual([T0 + 500, T0 + 1000, T0 + 2500]);
  });

  it("does not return what is older than the start of the window, and prunes it", async () => {
    const store = new PgHitStore(pool);
    await store.transaction(async (tx) => {
      await tx.add("a", T0 - 7_200_000);
      await tx.add("a", T0);
    });
    expect(await store.transaction((tx) => tx.keyHits("a", T0 - 60_000))).toEqual([T0]);
    await store.transaction((tx) => tx.prune(T0 - 3_600_000));
    expect(await store.transaction((tx) => tx.globalHits(0))).toEqual([T0]);
  });

  it("stores an address with quotes in it as plain text", async () => {
    const store = new PgHitStore(pool);
    await store.transaction((tx) => tx.add("1.2.3.4'; DROP TABLE assistant_rate_hits;--", T0));
    expect(await store.transaction((tx) => tx.keyHits("1.2.3.4'; DROP TABLE assistant_rate_hits;--", 0))).toEqual([T0]);
  });

  it("rolls back a failed transaction", async () => {
    const store = new PgHitStore(pool);
    await expect(store.transaction(async (tx) => { await tx.add("a", T0); throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await store.transaction((tx) => tx.globalHits(0))).toEqual([]);
  });
});

describe("the shared limiter on Postgres", () => {
  it("stops the request over the limit even when many arrive at once, from two limiters", async () => {
    let now = T0;
    const options = { perMinute: 3, perHour: 40, globalPerMinute: 100, now: () => now };
    const first = createSharedRateLimiter(new PgHitStore(pool), options);
    const second = createSharedRateLimiter(new PgHitStore(pool), options);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? first : second).check("a")));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    now += 61_000;
    expect((await first.check("a")).ok).toBe(true);
  });
});
