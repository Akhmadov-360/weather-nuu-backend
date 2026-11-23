import type { Pool } from "pg";
import type { RateLimiter, RateLimitResult } from "./rate-limiter.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/** What the limiter does between taking the lock and releasing it: no other process counts in between. */
export interface HitTx {
  /** Times (ms) of the requests of one address since `since`, oldest first. */
  keyHits(key: string, since: number): Promise<number[]>;
  /** Times (ms) of all requests since `since`, oldest first. */
  globalHits(since: number): Promise<number[]>;
  add(key: string, at: number): Promise<void>;
  prune(before: number): Promise<void>;
}

export interface HitStore {
  transaction<T>(fn: (tx: HitTx) => Promise<T>): Promise<T>;
}

/** Requests in the memory of one process, with a queue so that two checks never interleave. */
export class MemoryHitStore implements HitStore {
  private readonly byKey = new Map<string, number[]>();
  private all: number[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  transaction<T>(fn: (tx: HitTx) => Promise<T>): Promise<T> {
    const tx: HitTx = {
      keyHits: async (key, since) => (this.byKey.get(key) ?? []).filter((t) => t >= since),
      globalHits: async (since) => this.all.filter((t) => t >= since),
      add: async (key, at) => {
        this.byKey.set(key, [...(this.byKey.get(key) ?? []), at]);
        this.all.push(at);
      },
      prune: async (before) => {
        this.all = this.all.filter((t) => t >= before);
        for (const [key, times] of this.byKey) {
          const kept = times.filter((t) => t >= before);
          if (kept.length) this.byKey.set(key, kept);
          else this.byKey.delete(key);
        }
      },
    };
    const run = this.queue.then(() => fn(tx));
    this.queue = run.catch(() => undefined);
    return run;
  }
}

/**
 * Requests in PostgreSQL, so that several API processes count together. The lock is an advisory lock held for
 * the transaction: the read of the counters and the write of the new request cannot be split by another process.
 */
export class PgHitStore implements HitStore {
  /** Any number, the same in every process. */
  private static readonly LOCK = 7_236_001;

  constructor(private readonly pool: Pick<Pool, "connect">) {}

  async transaction<T>(fn: (tx: HitTx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [PgHitStore.LOCK]);
      const times = (rows: { t: string }[]) => rows.map((r) => Number(r.t));
      const tx: HitTx = {
        keyHits: async (key, since) =>
          times((await client.query("SELECT (extract(epoch FROM at) * 1000)::bigint AS t FROM assistant_rate_hits WHERE key = $1 AND at >= to_timestamp($2 / 1000.0) ORDER BY at", [key, since])).rows),
        globalHits: async (since) =>
          times((await client.query("SELECT (extract(epoch FROM at) * 1000)::bigint AS t FROM assistant_rate_hits WHERE at >= to_timestamp($1 / 1000.0) ORDER BY at", [since])).rows),
        add: async (key, at) => void (await client.query("INSERT INTO assistant_rate_hits (key, at) VALUES ($1, to_timestamp($2 / 1000.0))", [key, at])),
        prune: async (before) => void (await client.query("DELETE FROM assistant_rate_hits WHERE at < to_timestamp($1 / 1000.0)", [before])),
      };
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

const wait = (oldest: number, windowMs: number, at: number) => Math.max(1, Math.ceil((oldest + windowMs - at) / 1000));

/**
 * The same windows as the limiter in memory (a minute and an hour for one address, a minute for the whole
 * service), over a store that processes share. A refused request is not recorded.
 */
export function createSharedRateLimiter(
  store: HitStore,
  options: { perMinute: number; perHour: number; globalPerMinute: number; now?: () => number },
): RateLimiter {
  const now = options.now ?? Date.now;
  let lastPrune = 0;

  return {
    check: (key) =>
      store.transaction(async (tx): Promise<RateLimitResult> => {
        const at = now();
        const mine = await tx.keyHits(key, at - HOUR_MS);
        const lastMinute = mine.filter((t) => at - t < MINUTE_MS);
        if (lastMinute.length >= options.perMinute) return { ok: false, retryAfterSeconds: wait(lastMinute[0]!, MINUTE_MS, at) };
        if (mine.length >= options.perHour) return { ok: false, retryAfterSeconds: wait(mine[0]!, HOUR_MS, at) };
        const global = await tx.globalHits(at - MINUTE_MS);
        if (global.length >= options.globalPerMinute) return { ok: false, retryAfterSeconds: wait(global[0]!, MINUTE_MS, at) };

        await tx.add(key, at);
        // Forget what is older than the longest window, not on every request.
        if (at - lastPrune > MINUTE_MS) {
          lastPrune = at;
          await tx.prune(at - HOUR_MS);
        }
        return { ok: true };
      }),
  };
}

/**
 * If the shared store fails (the database is busy or down), the request is counted by the limiter in memory
 * instead: the assistant keeps being protected, and a failure of the counters never turns into a refusal.
 */
export function withFallback(shared: RateLimiter, local: RateLimiter, onError: (error: unknown) => void): RateLimiter {
  return {
    check: async (key) => {
      try {
        return await shared.check(key);
      } catch (error) {
        onError(error);
        return local.check(key);
      }
    },
  };
}
