import type { AssistantEvent } from "@weather/contracts";

/** The same question in the same language is the same key, whatever the case, the spaces and the closing punctuation. */
export function cacheKey(lang: string, message: string): string {
  return `${lang}|${message.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").replace(/[\s?!.,;:…]+$/u, "").trim()}`;
}

export type CachedAnswer = { events: AssistantEvent[]; storedAt: number };

/**
 * Answers that do not depend on the readings (norms, what a sensor measures, a greeting) are kept for a while and
 * repeated to the next person who asks the same: it costs no request to the model and answers at once.
 * The memory of one process, a limited number of entries, the oldest go first.
 */
export class AnswerCache {
  private readonly entries = new Map<string, CachedAnswer>();

  constructor(
    private readonly options: { ttlMs: number; maxEntries?: number; now?: () => number },
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  get enabled(): boolean {
    return this.options.ttlMs > 0;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): AssistantEvent[] | null {
    if (!this.enabled) return null;
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.now() - entry.storedAt > this.options.ttlMs) {
      this.entries.delete(key);
      return null;
    }
    return entry.events;
  }

  set(key: string, events: AssistantEvent[]): void {
    if (!this.enabled) return;
    this.entries.delete(key);
    this.entries.set(key, { events, storedAt: this.now() });
    const max = this.options.maxEntries ?? 200;
    while (this.entries.size > max) this.entries.delete(this.entries.keys().next().value as string);
  }
}
