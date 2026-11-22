export type ScoredIndex = { index: number; score: number };

/**
 * Keyword search with BM25 (formula (6) of the assistant document):
 *   BM25(q, d) = sum over terms t of q:  IDF(t) * f(t,d)(k1+1) / ( f(t,d) + k1(1 - b + b|d|/avgdl) )
 *   IDF(t)     = ln( (N - n(t) + 0.5) / (n(t) + 0.5) + 1 )
 * Built once over the tokenized fragments; a search walks only the lists of the terms of the question.
 */
export class Bm25Index {
  private readonly postings = new Map<string, { doc: number; tf: number }[]>();
  private readonly lengths: number[];
  private readonly avgdl: number;

  constructor(
    docs: string[][],
    private readonly k1 = 1.2,
    private readonly b = 0.75,
  ) {
    this.lengths = docs.map((d) => d.length);
    this.avgdl = docs.length ? this.lengths.reduce((a, n) => a + n, 0) / docs.length : 0;
    docs.forEach((terms, doc) => {
      const counts = new Map<string, number>();
      for (const t of terms) counts.set(t, (counts.get(t) ?? 0) + 1);
      for (const [term, tf] of counts) {
        const list = this.postings.get(term);
        if (list) list.push({ doc, tf });
        else this.postings.set(term, [{ doc, tf }]);
      }
    });
  }

  get size(): number {
    return this.lengths.length;
  }

  /** Documents with a positive score, best first. `allowed` limits the search to some documents (filters run before ranking). */
  search(query: string[], allowed?: Set<number>): ScoredIndex[] {
    const scores = new Map<number, number>();
    const n = this.size;
    for (const term of new Set(query)) {
      const list = this.postings.get(term);
      if (!list) continue;
      const idf = Math.log((n - list.length + 0.5) / (list.length + 0.5) + 1);
      for (const { doc, tf } of list) {
        if (allowed && !allowed.has(doc)) continue;
        const norm = this.k1 * (1 - this.b + (this.b * this.lengths[doc]!) / this.avgdl);
        scores.set(doc, (scores.get(doc) ?? 0) + (idf * tf * (this.k1 + 1)) / (tf + norm));
      }
    }
    return [...scores].map(([index, score]) => ({ index, score })).sort((a, b) => b.score - a.score || a.index - b.index);
  }
}
