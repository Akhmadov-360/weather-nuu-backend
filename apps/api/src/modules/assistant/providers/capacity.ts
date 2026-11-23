import { ProviderError, type ChatProvider, type GenerateInput, type ProviderChunk } from "./types.js";

export type ModelSlot = {
  /** The model's name, for the log and the counters. */
  name: string;
  provider: ChatProvider;
  /** Requests a day this model is allowed (the quota of the key). Past it the slot is skipped without asking the model. */
  dailyLimit?: number;
};

export type CapacityEvent =
  | { type: "fallback"; from: string; to: string }
  | { type: "near_limit"; model: string; used: number; limit: number }
  | { type: "exhausted"; models: string[] };

export type ModelUsage = { model: string; today: number; limit: number | null; cooling: boolean };

/** The day of the quota of Google models ends at midnight Pacific time, not UTC. */
function quotaDay(at: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(at);
}

/**
 * Several models behind one `ChatProvider`, in the order of preference. A request goes to the first model
 * that is not cooling down and has not used its day's allowance; when that model answers "quota" before
 * saying anything, it cools down for a while and the request is repeated on the next one. Every model has
 * its own quota, so the second one adds its capacity. An error after the first piece of the answer is not
 * repeated: the visitor has already seen part of it.
 */
export class CapacityProvider implements ChatProvider {
  private readonly cooling = new Map<string, number>();
  private readonly used = new Map<string, { day: string; count: number }>();
  private readonly warned = new Set<string>();

  constructor(
    private readonly slots: ModelSlot[],
    private readonly options: { now?: () => number; cooldownMs?: number; warnAt?: number; onEvent?: (event: CapacityEvent) => void } = {},
  ) {
    if (slots.length === 0) throw new Error("CapacityProvider needs at least one model");
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private countToday(name: string): number {
    const day = quotaDay(this.now());
    const entry = this.used.get(name);
    return entry && entry.day === day ? entry.count : 0;
  }

  private count(slot: ModelSlot): void {
    const day = quotaDay(this.now());
    const count = this.countToday(slot.name) + 1;
    this.used.set(slot.name, { day, count });
    const warnAt = this.options.warnAt ?? 0.8;
    const key = `${slot.name}:${day}`;
    if (slot.dailyLimit && count >= slot.dailyLimit * warnAt && !this.warned.has(key)) {
      this.warned.add(key);
      this.options.onEvent?.({ type: "near_limit", model: slot.name, used: count, limit: slot.dailyLimit });
    }
  }

  /** What each model has used today, and whether it is resting after a refusal. */
  usageSnapshot(): ModelUsage[] {
    const at = this.now();
    return this.slots.map((s) => ({ model: s.name, today: this.countToday(s.name), limit: s.dailyLimit ?? null, cooling: (this.cooling.get(s.name) ?? 0) > at }));
  }

  async *generate(input: GenerateInput): AsyncGenerator<ProviderChunk> {
    const at = this.now();
    const available = this.slots.filter((s) => (this.cooling.get(s.name) ?? 0) <= at && !(s.dailyLimit && this.countToday(s.name) >= s.dailyLimit));
    // Nothing is free: try the first anyway (its quota may have come back) rather than refuse without asking.
    const order = available.length ? available : [this.slots[0]!];
    let lastQuota: ProviderError | undefined;

    for (const [i, slot] of order.entries()) {
      let started = false;
      try {
        for await (const chunk of slot.provider.generate(input)) {
          started = true;
          yield chunk;
        }
        this.count(slot);
        return;
      } catch (error) {
        if (input.signal.aborted) return;
        if (error instanceof ProviderError && error.kind === "quota" && !started) {
          lastQuota = error;
          this.cooling.set(slot.name, this.now() + (this.options.cooldownMs ?? 60_000));
          const next = order[i + 1];
          if (next) this.options.onEvent?.({ type: "fallback", from: slot.name, to: next.name });
          continue;
        }
        throw error;
      }
    }
    this.options.onEvent?.({ type: "exhausted", models: order.map((s) => s.name) });
    throw lastQuota ?? new ProviderError("quota", "Every model is out of quota", 429);
  }
}
